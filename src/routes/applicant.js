const express = require('express');
const { db, audit } = require('../db');
const { sections, byKey, validateSection } = require('../schema');
const { sanitizeFields, fileKeyAllowed } = require('../forms');
const { historyGaps } = require('../timeline');
const apps = require('../apps');
const files = require('../files');
const mailer = require('../mailer');
const report = require('../report');
const config = require('../config');
const { requireApplicant } = require('../middleware');

const router = express.Router();
router.use(requireApplicant);

const EDITABLE = ['in_progress', 'info_requested'];

router.use((req, res, next) => {
  let app = apps.getByUser(req.user.id);
  if (!app) app = apps.createForUser(req.user.id);
  req.app_ = app;
  res.locals.application = app;
  res.locals.editable = EDITABLE.includes(app.status);
  next();
});

function sectionDocs(appId, sectionKey) {
  const out = {};
  for (const d of apps.docs(appId)) {
    if (!d.field_key.startsWith(`${sectionKey}:`)) continue;
    const k = d.field_key.slice(sectionKey.length + 1);
    (out[k] = out[k] || []).push({ id: d.id, name: d.original_name, size: d.size, mime: d.mime });
  }
  return out;
}

function prefillSource(user, all) {
  return {
    first_name: user.first_name, last_name: user.last_name, email: user.email, phone: user.phone,
    fullname: all.application && all.application.forenames ? `${all.application.forenames} ${all.application.surname || ''}`.trim() : `${user.first_name} ${user.last_name}`,
    get: (path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), all),
  };
}

// First visit to a section: pre-fill from the account / earlier sections and add starter repeater rows.
function initialValues(section, src) {
  const out = {};
  for (const f of section.fields) {
    if (f.prefill) out[f.key] = src[f.prefill] !== undefined ? src[f.prefill] : src.get(f.prefill);
    else if (f.default !== undefined) out[f.key] = f.default;
    if (f.type === 'repeater' && f.min) out[f.key] = Array.from({ length: f.min }, () => ({ _id: require('crypto').randomBytes(6).toString('hex') }));
  }
  return out;
}

router.get('/', (req, res) => {
  const app = req.app_;
  const state = apps.sectionState(app);
  const adminNote = apps.adminData(app).info_request || null;
  res.render('applicant/dashboard', {
    title: 'My onboarding',
    sections, state, progress: apps.progress(app), adminNote,
    allComplete: sections.every((s) => state[s.key] === 'complete'),
  });
});

router.get('/section/:key', (req, res, next) => {
  const section = byKey[req.params.key];
  if (!section) return next();
  const app = req.app_;
  const all = apps.data(app);
  const idx = sections.indexOf(section);
  res.render('applicant/section', {
    title: section.title,
    section, sections, idx,
    values: all[section.key] || initialValues(section, prefillSource(req.user, all)),
    docs: sectionDocs(app.id, section.key),
    state: apps.sectionState(app),
    gapDays: config.screening.gapDays,
    periodYears: config.screening.periodYears,
  });
});

router.post('/section/:key', (req, res, next) => {
  const section = byKey[req.params.key];
  if (!section) return next();
  const app = apps.get(req.app_.id);
  if (!EDITABLE.includes(app.status)) return res.status(409).json({ error: 'Your application has been submitted and can no longer be edited.' });
  const all = apps.data(app);
  const complete = req.body.action === 'complete';
  const clean = sanitizeFields(section.fields, req.body.data, all[section.key], { ip: req.ip, signer: `${req.user.first_name} ${req.user.last_name}` });
  let errors = {};
  if (complete) {
    const counts = {};
    for (const [k, n] of Object.entries(apps.docCounts(app.id))) if (k.startsWith(`${section.key}:`)) counts[k.slice(section.key.length + 1)] = n;
    errors = validateSection(section, clean, counts);
  }
  const ok = !Object.keys(errors).length;
  apps.saveSection(app, section.key, clean, complete && ok);
  audit({ applicationId: app.id, user: req.user, action: complete && ok ? 'section_completed' : 'section_saved', detail: section.title, ip: req.ip });
  const idx = sections.indexOf(section);
  const nextSection = sections[idx + 1];
  res.json({ ok, errors, data: clean, next: ok && complete ? (nextSection ? `/apply/section/${nextSection.key}` : '/apply/review') : null });
});

router.post('/timeline', (req, res) => {
  res.json(historyGaps(Array.isArray(req.body.history) ? req.body.history : []));
});

router.post('/upload', files.upload.single('file'), (req, res) => {
  const app = req.app_;
  if (!EDITABLE.includes(app.status)) return res.status(409).json({ error: 'Your application can no longer be edited.' });
  const key = String(req.body.field_key || '');
  const section = byKey[key.split(':')[0]];
  if (!section || !fileKeyAllowed(section, key)) return res.status(400).json({ error: 'Invalid upload field.' });
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  if (db.prepare('SELECT COUNT(*) AS n FROM documents WHERE application_id = ?').get(app.id).n >= 80) return res.status(400).json({ error: 'Upload limit reached.' });
  try {
    const doc = files.store(app.id, key, req.file, req.user.id);
    audit({ applicationId: app.id, user: req.user, action: 'document_uploaded', detail: `${doc.original_name} (${key})`, ip: req.ip });
    res.json({ id: doc.id, name: doc.original_name, size: doc.size, mime: doc.mime });
  } catch (e) {
    res.status(400).json({ error: e.expose ? e.message : 'Upload failed.' });
  }
});

router.post('/upload/:id/delete', (req, res) => {
  const app = req.app_;
  if (!EDITABLE.includes(app.status)) return res.status(409).json({ error: 'Your application can no longer be edited.' });
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND application_id = ?').get(req.params.id, app.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  files.remove(doc);
  audit({ applicationId: app.id, user: req.user, action: 'document_deleted', detail: doc.original_name, ip: req.ip });
  res.json({ ok: true });
});

router.get('/file/:id', (req, res, next) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND application_id = ?').get(req.params.id, req.app_.id);
  if (!doc) return next();
  files.sendDoc(res, doc, false);
});

router.get('/review', (req, res) => {
  const app = req.app_;
  const state = apps.sectionState(app);
  res.render('applicant/review', {
    title: 'Review & submit',
    sections, state, all: apps.data(app), docs: apps.docs(app.id),
    allComplete: sections.every((s) => state[s.key] === 'complete'),
    fileBase: '/apply/file/',
  });
});

router.post('/submit', async (req, res) => {
  const app = apps.get(req.app_.id);
  if (!EDITABLE.includes(app.status)) return res.redirect('/apply');
  const state = apps.sectionState(app);
  const missing = sections.filter((s) => state[s.key] !== 'complete');
  if (missing.length) {
    req.flash('error', `Please complete: ${missing.map((s) => s.title).join(', ')}.`);
    return res.redirect('/apply');
  }
  if (req.body.final_confirm !== 'yes') {
    req.flash('error', 'Please confirm the final declaration before submitting.');
    return res.redirect('/apply/review');
  }
  const resubmission = app.status === 'info_requested';
  db.prepare(`UPDATE applications SET status = 'submitted', submitted_at = datetime('now'),
    screening_started_at = COALESCE(screening_started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`).run(app.id);
  if (resubmission) apps.saveAdmin(app, { info_request: null });
  const fresh = apps.get(app.id);
  apps.syncVerifications(fresh);
  apps.ensureChecks(fresh.id);
  audit({ applicationId: app.id, user: req.user, action: resubmission ? 'application_resubmitted' : 'application_submitted', ip: req.ip });
  try { await report.snapshot(fresh, req.user, resubmission ? 'Applicant resubmission' : 'Applicant submission'); } catch (e) { console.error('Report snapshot failed', e); }

  const name = apps.applicantName(fresh);
  mailer.send({
    to: req.user.email, applicationId: app.id,
    subject: `Application ${fresh.ref} received`,
    title: 'Thank you – we have received your application',
    html: `<p>Dear ${mailer.esc(name)},</p><p>Your onboarding application <strong>${fresh.ref}</strong> has been submitted. Our screening team will now begin your BS 7858 security screening, which includes verifying your 5-year history and taking up references.</p><p>We will contact you if we need anything further. You can check your status at any time by signing in.</p>`,
  }).catch(() => {});
  mailer.send({
    to: config.company.email, applicationId: app.id,
    subject: `[Screening] ${resubmission ? 'Resubmitted' : 'New'} application ${fresh.ref} – ${name}`,
    title: `${resubmission ? 'Application resubmitted' : 'New application submitted'}`,
    html: `<p><strong>${mailer.esc(name)}</strong> has ${resubmission ? 'resubmitted' : 'submitted'} application <strong>${fresh.ref}</strong>.</p><p><a href="${config.baseUrl}/admin/applications/${fresh.id}">Open in the screening portal</a></p>`,
  }).catch(() => {});
  req.flash('success', 'Your application has been submitted. Thank you!');
  res.redirect('/apply');
});

router.get('/account', (req, res) => res.render('applicant/account', { title: 'My account', error: null }));

router.post('/account/password', (req, res) => {
  const bcrypt = require('bcryptjs');
  const { passwordError } = require('./auth');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(req.body.current || ''), u.password_hash)) return res.render('applicant/account', { title: 'My account', error: 'Your current password is incorrect.' });
  const pe = passwordError(req.body.password) || (req.body.password !== req.body.password2 ? 'Passwords do not match.' : null);
  if (pe) return res.render('applicant/account', { title: 'My account', error: pe });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(req.body.password, 12), u.id);
  audit({ user: req.user, action: 'password_changed', ip: req.ip });
  req.flash('success', 'Password updated.');
  res.redirect('/apply/account');
});

module.exports = router;
