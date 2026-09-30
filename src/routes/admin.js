const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db, audit } = require('../db');
const { sections } = require('../schema');
const { historyGaps } = require('../timeline');
const { encrypt, decrypt, token } = require('../crypto');
const apps = require('../apps');
const files = require('../files');
const mailer = require('../mailer');
const report = require('../report');
const config = require('../config');
const verify = require('../verify');
const settings = require('../settings');
const contracts = require('../contracts');
const { requireStaff, requireSuper } = require('../middleware');

const router = express.Router();
router.use(requireStaff);

const SIG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const staffName = (u) => `${u.first_name} ${u.last_name}`;
const sig = (req, raw) => (raw && SIG_RE.test(raw) && raw.length < 400000 ? { image: raw, signedAt: new Date().toISOString(), ip: req.ip, signer: staffName(req.user) } : null);

function loadApp(req, res, next) {
  const app = apps.get(Number(req.params.id));
  if (!app) return res.status(404).render('error', { title: 'Not found', message: 'Application not found.' });
  req.app_ = app;
  next();
}

function summary(app) {
  const all = apps.data(app);
  const a = all.application || {};
  const dl = apps.deadline(app);
  const d = all.documents || {};
  const siaDays = d.sia_expiry ? Math.ceil((new Date(d.sia_expiry) - Date.now()) / 86400000) : null;
  const checks = db.prepare("SELECT status, COUNT(*) AS n FROM checks WHERE application_id = ? GROUP BY status").all(app.id);
  const passed = (checks.find((c) => c.status === 'pass') || {}).n || 0;
  const na = (checks.find((c) => c.status === 'na') || {}).n || 0;
  return {
    ...app, name: apps.applicantName(app), position: a.position, progress: apps.progress(app), deadline: dl,
    siaNumber: d.sia_number, siaExpiry: d.sia_expiry, siaDays, checksDone: passed + na, checksTotal: apps.CHECK_TYPES.length,
    email: (db.prepare('SELECT email FROM users WHERE id = ?').get(app.user_id) || {}).email,
  };
}

// ---------------- Dashboard ----------------
router.get('/', (req, res) => {
  const all = db.prepare('SELECT * FROM applications ORDER BY updated_at DESC').all().map(summary);
  const counts = Object.fromEntries(Object.keys(apps.STATUSES).map((k) => [k, 0]));
  all.forEach((a) => { counts[a.status] = (counts[a.status] || 0) + 1; });
  const active = all.filter((a) => ['submitted', 'under_review', 'info_requested', 'provisional'].includes(a.status));
  const overdue = active.filter((a) => a.deadline && a.deadline.daysLeft < 14).sort((x, y) => x.deadline.daysLeft - y.deadline.daysLeft);
  const siaAlerts = all.filter((a) => a.siaDays !== null && a.siaDays < 60 && !['rejected', 'withdrawn'].includes(a.status)).sort((x, y) => x.siaDays - y.siaDays);
  const recent = db.prepare('SELECT l.*, a.ref FROM audit_log l LEFT JOIN applications a ON a.id = l.application_id WHERE l.application_id IS NOT NULL ORDER BY l.id DESC LIMIT 12').all();
  res.render('admin/dashboard', { title: 'Screening dashboard', counts, total: all.length, active, overdue, siaAlerts, recent, latest: all.slice(0, 8) });
});

// ---------------- List ----------------
router.get('/applications', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '');
  let list = db.prepare('SELECT * FROM applications ORDER BY updated_at DESC').all().map(summary);
  if (status) list = list.filter((a) => a.status === status);
  if (q) list = list.filter((a) => [a.name, a.ref, a.email, a.position, a.siaNumber].filter(Boolean).join(' ').toLowerCase().includes(q));
  res.render('admin/list', { title: 'Applicants', list, q, status });
});

// ---------------- Detail ----------------
router.get('/applications/:id', loadApp, (req, res) => {
  const app = req.app_;
  if (app.status !== 'in_progress') apps.syncVerifications(app);
  const all = apps.data(app);
  const tab = String(req.query.tab || 'overview');
  const verifs = apps.verifications(app.id).map((v) => ({ ...v, response: v.response_enc ? decrypt(v.response_enc) : null }));
  res.render('admin/detail', {
    title: `${apps.applicantName(app)} – ${app.ref}`,
    app: summary(app), raw: app, all, admin: apps.adminData(app), tab,
    sections, state: apps.sectionState(app), docs: apps.docs(app.id),
    checks: apps.checks(app.id), verifs, gaps: historyGaps((all.application || {}).history || []),
    reports: db.prepare(`SELECT r.*, u.first_name || ' ' || u.last_name AS by_name FROM reports r LEFT JOIN users u ON u.id = r.created_by WHERE application_id = ? ORDER BY id DESC`).all(app.id),
    log: db.prepare('SELECT * FROM audit_log WHERE application_id = ? ORDER BY id DESC').all(app.id),
    emails: db.prepare('SELECT id, to_addr, subject, status, created_at FROM emails WHERE application_id = ? ORDER BY id DESC').all(app.id),
    staff: db.prepare("SELECT id, first_name, last_name FROM users WHERE role IN ('reviewer','superadmin') AND active = 1").all(),
    VERIFICATION_STATUSES: apps.VERIFICATION_STATUSES, LETTER_CODES: apps.LETTER_CODES, DOC_REGISTER: report.DOC_REGISTER,
    checkLinks: config.checkLinks, fileBase: `/admin/applications/${app.id}/file/`, screening: config.screening, openCheck: String(req.query.open || ''), refLabel: require('./referee').labelFor,
    contracts: contracts.list(app.id), contractAuto: contracts.autoFields(app), CONTRACT_FIELDS: contracts.EDITABLE, contractHasSig: !!settings.get('contract_defaults').issuer_signature,
  });
});

router.post('/applications/:id/status', loadApp, (req, res) => {
  const status = String(req.body.status || '');
  if (!apps.STATUSES[status]) return res.redirect(`/admin/applications/${req.app_.id}`);
  apps.setStatus(req.app_, status);
  audit({ applicationId: req.app_.id, user: req.user, action: 'status_changed', detail: `${apps.STATUSES[status].label}${req.body.note ? ` – ${req.body.note}` : ''}`, ip: req.ip });
  req.flash('success', `Status updated to "${apps.STATUSES[status].label}".`);
  res.redirect(`/admin/applications/${req.app_.id}`);
});

router.post('/applications/:id/assign', loadApp, (req, res) => {
  const uid = Number(req.body.assigned_to) || null;
  db.prepare('UPDATE applications SET assigned_to = ? WHERE id = ?').run(uid, req.app_.id);
  const u = uid ? db.prepare('SELECT * FROM users WHERE id = ?').get(uid) : null;
  audit({ applicationId: req.app_.id, user: req.user, action: 'assigned', detail: u ? staffName(u) : 'Unassigned', ip: req.ip });
  res.redirect(`/admin/applications/${req.app_.id}`);
});

router.post('/applications/:id/request-info', loadApp, async (req, res) => {
  const msg = String(req.body.message || '').trim().slice(0, 4000);
  if (!msg) { req.flash('error', 'Please enter a message for the applicant.'); return res.redirect(`/admin/applications/${req.app_.id}`); }
  const app = req.app_;
  apps.setStatus(app, 'info_requested');
  apps.saveAdmin(app, { info_request: { message: msg, by: staffName(req.user), at: new Date().toISOString() } });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(app.user_id);
  await mailer.send({
    to: u.email, applicationId: app.id, subject: `Action required – application ${app.ref}`, title: 'We need a little more information',
    html: `<p>Dear ${mailer.esc(u.first_name)},</p><p>Our screening team has reviewed your application and needs the following:</p>
      <blockquote style="border-left:3px solid #0c2547;margin:12px 0;padding:8px 14px;background:#f3f6fb">${mailer.esc(msg).replace(/\n/g, '<br>')}</blockquote>
      <p>Please sign in, update your application and resubmit.</p><p><a href="${config.baseUrl}/login" style="background:#0c2547;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Update my application</a></p>`,
  });
  audit({ applicationId: app.id, user: req.user, action: 'info_requested', detail: msg, ip: req.ip });
  req.flash('success', 'The applicant has been asked for more information and can now edit their application.');
  res.redirect(`/admin/applications/${app.id}`);
});

// ---------------- Checks ----------------
router.post('/applications/:id/checks/:type', loadApp, files.uploadMany.array('evidence', 10), (req, res) => {
  const type = req.params.type;
  if (!apps.CHECK_TYPES.find((c) => c.type === type)) return res.status(400).json({ error: 'Unknown check' });
  const status = ['pending', 'pass', 'fail', 'refer', 'na'].includes(req.body.status) ? req.body.status : 'pending';
  apps.ensureChecks(req.app_.id);
  db.prepare(`UPDATE checks SET status = ?, reference = ?, notes = ?, checked_by = ?, checked_at = datetime('now') WHERE application_id = ? AND type = ?`)
    .run(status, String(req.body.reference || '').slice(0, 300), String(req.body.notes || '').slice(0, 3000), req.user.id, req.app_.id, type);
  // Evidence screenshots/PDFs: auto-named, linked to this check, and attributed to the signed-in user.
  const key = `admin:check_${type}`;
  const names = (apps.checkEvidence(req.app_.id)[type] || []).map((d) => d.original_name);
  const attached = [];
  for (const f of req.files || []) {
    try {
      const doc = files.store(req.app_.id, key, f, req.user.id, (ext) => apps.evidenceFilename(req.app_, type, ext, names));
      names.push(doc.original_name);
      attached.push(doc.original_name);
      audit({ applicationId: req.app_.id, user: req.user, action: 'evidence_attached', detail: `${type}: ${doc.original_name}`, ip: req.ip });
    } catch (e) {
      if (!e.expose) throw e;
    }
  }
  audit({ applicationId: req.app_.id, user: req.user, action: 'check_recorded', detail: `${type}: ${status}${req.body.reference ? ` (${req.body.reference})` : ''}${attached.length ? ` + ${attached.length} evidence file(s)` : ''}`, ip: req.ip });
  if (status !== 'pending' && req.app_.status === 'submitted') apps.setStatus(req.app_, 'under_review');
  req.flash('success', `Check recorded${attached.length ? ` with ${attached.length} evidence file${attached.length > 1 ? 's' : ''}: ${attached.join(', ')}` : ''}.`);
  const dest = `/admin/applications/${req.app_.id}?tab=checks&open=${type}#check-${type}`;
  if ((req.get('accept') || '').includes('json')) return res.json({ ok: true, redirect: dest, attached });
  res.redirect(dest);
});

router.post('/applications/:id/evidence/:docId/delete', loadApp, (req, res) => {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ? AND application_id = ? AND field_key LIKE 'admin:check_%'").get(req.params.docId, req.app_.id);
  if (!doc) return res.redirect(`/admin/applications/${req.app_.id}?tab=checks`);
  const type = doc.field_key.slice('admin:check_'.length);
  files.remove(doc);
  audit({ applicationId: req.app_.id, user: req.user, action: 'evidence_removed', detail: `${type}: ${doc.original_name}`, ip: req.ip });
  req.flash('success', `Removed ${doc.original_name}.`);
  res.redirect(`/admin/applications/${req.app_.id}?tab=checks&open=${type}#check-${type}`);
});

// ---------------- Verifications ----------------
router.post('/applications/:id/verifications/:vid/send', loadApp, async (req, res) => {
  const v = db.prepare('SELECT * FROM verifications WHERE id = ? AND application_id = ?').get(req.params.vid, req.app_.id);
  if (!v) return res.redirect(`/admin/applications/${req.app_.id}?tab=verification`);
  const r = await verify.sendRequest(req.app_, v, { user: req.user, ip: req.ip });
  req.flash(r.ok ? 'success' : 'error', r.ok ? (r.status === 'sent' ? 'Request emailed.' : 'Request saved to the Outbox (SMTP not configured) – copy the link to send manually.') : r.msg);
  res.redirect(`/admin/applications/${req.app_.id}?tab=verification`);
});

router.post('/applications/:id/verifications/send-all', loadApp, async (req, res) => {
  const list = db.prepare("SELECT * FROM verifications WHERE application_id = ? AND status = 'not_sent'").all(req.app_.id);
  let sent = 0; const skipped = [];
  for (const v of list) { const r = await verify.sendRequest(req.app_, v, { user: req.user, ip: req.ip }); if (r.ok) sent++; else skipped.push(v.label); }
  req.flash(skipped.length ? 'error' : 'success', `${sent} request(s) processed.${skipped.length ? ` No email address for: ${skipped.join('; ')}` : ''}`);
  res.redirect(`/admin/applications/${req.app_.id}?tab=verification`);
});

router.post('/applications/:id/verifications/:vid', loadApp, (req, res) => {
  const v = db.prepare('SELECT * FROM verifications WHERE id = ? AND application_id = ?').get(req.params.vid, req.app_.id);
  if (!v) return res.redirect(`/admin/applications/${req.app_.id}?tab=verification`);
  const status = apps.VERIFICATION_STATUSES[req.body.status] ? req.body.status : v.status;
  const code = apps.LETTER_CODES[req.body.code] ? req.body.code : v.code;
  const month = (x) => (/^\d{4}-\d{2}$/.test(x || '') ? x : null);
  const email = String(req.body.contact_email || '').trim();
  db.prepare('UPDATE verifications SET status = ?, code = ?, confirmed_from = ?, confirmed_to = ?, notes = ?, contact_email = ?, updated_by = ? WHERE id = ?')
    .run(status, code, month(req.body.confirmed_from), month(req.body.confirmed_to), String(req.body.notes || '').slice(0, 3000), email || v.contact_email, req.user.id, v.id);
  audit({ applicationId: req.app_.id, user: req.user, action: 'verification_updated', detail: `${v.label}: ${apps.VERIFICATION_STATUSES[status]}`, ip: req.ip });
  req.flash('success', 'Verification updated.');
  res.redirect(`/admin/applications/${req.app_.id}?tab=verification`);
});

// ---------------- Employer sections / register / authorisation ----------------
router.post('/applications/:id/employer', loadApp, (req, res) => {
  const app = req.app_;
  const admin = apps.adminData(app);
  const part = req.body.part;
  const patch = {};
  if (part === 'health') {
    patch.health = { comments: String(req.body.comments || '').slice(0, 5000), signature: sig(req, req.body.signature) || (admin.health || {}).signature || null, by: staffName(req.user), at: new Date().toISOString() };
  } else if (part === 'optout') {
    const s = sig(req, req.body.signature);
    if (!s) { req.flash('error', 'Please sign before saving.'); return res.redirect(`/admin/applications/${app.id}?tab=employer`); }
    patch.optout = { signature: s, by: staffName(req.user), at: new Date().toISOString() };
  } else if (part === 'bank') {
    patch.bank = { by: staffName(req.user), at: new Date().toISOString() };
  } else if (part === 'register') {
    const reg = {};
    for (const [i, name] of report.DOC_REGISTER.entries()) {
      reg[name] = { seen: ['copy', 'original', 'na'].includes(req.body[`seen_${i}`]) ? req.body[`seen_${i}`] : '', comments: String(req.body[`comments_${i}`] || '').slice(0, 500) };
    }
    patch.documents_register = reg;
  } else if (part === 'screening_completed') {
    patch.screening_completed = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : null;
  } else return res.redirect(`/admin/applications/${app.id}`);
  apps.saveAdmin(app, patch);
  audit({ applicationId: app.id, user: req.user, action: 'employer_record_updated', detail: part, ip: req.ip });
  req.flash('success', 'Saved.');
  res.redirect(`/admin/applications/${app.id}?tab=${part === 'register' || part === 'screening_completed' ? 'checks' : 'employer'}`);
});

router.post('/applications/:id/authorise', loadApp, async (req, res) => {
  const app = req.app_;
  const stage = req.body.stage;
  const map = { conditional: 'provisional', confirmed: 'cleared', declined: 'rejected' };
  if (!map[stage]) return res.redirect(`/admin/applications/${app.id}?tab=decision`);
  const s = sig(req, req.body.signature);
  if (!s) { req.flash('error', 'An authorised signature is required.'); return res.redirect(`/admin/applications/${app.id}?tab=decision`); }
  if (stage === 'confirmed') {
    const pending = db.prepare("SELECT COUNT(*) AS n FROM checks WHERE application_id = ? AND status IN ('pending','fail','refer')").get(app.id).n;
    if (pending && req.body.override !== 'yes') {
      req.flash('error', `${pending} screening check(s) are not passed. Complete them, or tick the override box to confirm anyway.`);
      return res.redirect(`/admin/applications/${app.id}?tab=decision`);
    }
  }
  const admin = apps.adminData(app);
  const auth = admin.authorisation || {};
  auth[stage] = {
    by: staffName(req.user), at: new Date().toISOString(), signature: s,
    start_date: /^\d{4}-\d{2}-\d{2}$/.test(req.body.start_date || '') ? req.body.start_date : null,
    notes: String(req.body.notes || '').slice(0, 3000),
  };
  apps.saveAdmin(app, { authorisation: auth });
  apps.setStatus(app, map[stage]);
  audit({ applicationId: app.id, user: req.user, action: `authorisation_${stage}`, detail: auth[stage].notes, ip: req.ip });
  const fresh = apps.get(app.id);
  try { await report.snapshot(fresh, req.user, `Authorisation – ${stage}`); } catch (e) { console.error(e); }
  if (req.body.notify === 'yes') {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(app.user_id);
    const msgs = {
      conditional: 'We are pleased to confirm you have been <strong>provisionally cleared</strong> to start work while the remainder of your BS 7858 screening is completed.',
      confirmed: 'We are pleased to confirm that your BS 7858 security screening is <strong>complete</strong> and you have been cleared.',
      declined: 'Thank you for your application. Unfortunately we are unable to offer you a position on this occasion.',
    };
    await mailer.send({ to: u.email, applicationId: app.id, subject: `Your application ${app.ref}`, title: 'Screening update',
      html: `<p>Dear ${mailer.esc(u.first_name)},</p><p>${msgs[stage]}</p>${auth[stage].start_date && stage !== 'declined' ? `<p>Start date: <strong>${auth[stage].start_date.split('-').reverse().join('/')}</strong></p>` : ''}<p>Kind regards,<br>${mailer.esc(config.company.name)} Screening Team</p>` });
  }
  req.flash('success', 'Authorisation recorded and a report snapshot has been saved.');
  res.redirect(`/admin/applications/${app.id}?tab=decision`);
});

// ---------------- Files & reports ----------------
router.get('/applications/:id/file/:docId', loadApp, (req, res, next) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND application_id = ?').get(req.params.docId, req.app_.id);
  if (!doc) return next();
  audit({ applicationId: req.app_.id, user: req.user, action: 'document_viewed', detail: doc.original_name, ip: req.ip });
  files.sendDoc(res, doc, req.query.download === '1');
});

router.get('/applications/:id/report.pdf', loadApp, async (req, res) => {
  const app = req.app_;
  if (req.query.fullBank === '1' && req.user.role !== 'superadmin') return res.status(403).send('Forbidden');
  const buf = await report.build(app, {
    generatedBy: staffName(req.user), reason: 'On-demand',
    includeDiversity: req.query.diversity === '1', fullBank: req.query.fullBank === '1', includeImages: req.query.images !== '0',
  });
  audit({ applicationId: app.id, user: req.user, action: 'report_generated', detail: [req.query.diversity === '1' && 'with diversity', req.query.fullBank === '1' && 'full bank details'].filter(Boolean).join(', ') || null, ip: req.ip });
  res.set('Content-Type', 'application/pdf');
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${app.ref}-screening-file.pdf"`);
  res.send(buf);
});

router.post('/applications/:id/snapshot', loadApp, async (req, res) => {
  await report.snapshot(req.app_, req.user, String(req.body.reason || 'Manual snapshot').slice(0, 120));
  audit({ applicationId: req.app_.id, user: req.user, action: 'report_snapshot', ip: req.ip });
  req.flash('success', 'Report snapshot saved.');
  res.redirect(`/admin/applications/${req.app_.id}?tab=reports`);
});

router.get('/reports/:rid', (req, res, next) => {
  const row = db.prepare('SELECT r.*, a.ref FROM reports r JOIN applications a ON a.id = r.application_id WHERE r.id = ?').get(req.params.rid);
  if (!row) return next();
  audit({ applicationId: row.application_id, user: req.user, action: 'report_downloaded', detail: `Snapshot #${row.id}`, ip: req.ip });
  res.set('Content-Type', 'application/pdf');
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', `inline; filename="${row.ref}-snapshot-${row.id}.pdf"`);
  res.send(report.readSnapshot(row));
});

router.post('/applications/:id/delete', requireSuper, loadApp, (req, res) => {
  const app = req.app_;
  if (req.body.confirm_ref !== app.ref) { req.flash('error', 'Type the application reference exactly to confirm deletion.'); return res.redirect(`/admin/applications/${app.id}?tab=audit`); }
  for (const d of apps.docs(app.id)) files.remove(d);
  for (const r of db.prepare('SELECT * FROM reports WHERE application_id = ?').all(app.id)) { try { require('fs').unlinkSync(require('path').join(config.reportDir, r.stored_name)); } catch { /* */ } }
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(app.user_id);
  db.prepare('DELETE FROM applications WHERE id = ?').run(app.id);
  if (u && u.role === 'applicant') db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  audit({ user: req.user, action: 'application_erased', detail: `${app.ref} permanently deleted (data erasure)`, ip: req.ip });
  req.flash('success', `${app.ref} and all associated data have been permanently deleted.`);
  res.redirect('/admin/applications');
});

// ---------------- Contracts ----------------
const contractFields = (body) => Object.fromEntries(contracts.EDITABLE.map((f) => [f.key, String(body[f.key] || '').trim()]));

async function emailContract(app, contract, user) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(app.user_id);
  const tpl = settings.get('email_contract');
  const v = contracts.vars(app, contract.fields);
  const link = `${config.baseUrl}/login?next=${encodeURIComponent('/apply/contract')}`;
  return mailer.send({
    to: u.email, applicationId: app.id, title: '',
    subject: settings.merge(tpl.subject, v),
    html: mailer.renderTemplate(tpl.body, v, { contract_link: { url: link, label: 'Review and sign my contract' } }),
  });
}

router.get('/applications/:id/contract/preview.pdf', loadApp, async (req, res) => {
  const app = req.app_;
  const { fields, body } = contracts.prepare(app, { ...contracts.autoFields(app), ...contractFields(req.query) });
  const buf = await contracts.pdf({ app, body, fields, issuerSignature: settings.get('contract_defaults').issuer_signature, draft: true });
  res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="Contract_preview_${app.ref}.pdf"` });
  res.send(buf);
});

router.post('/applications/:id/contract/send', loadApp, async (req, res) => {
  const app = req.app_;
  const back = `/admin/applications/${app.id}?tab=contract`;
  if (app.status === 'in_progress') { req.flash('error', 'The officer must submit their application before a contract can be sent.'); return res.redirect(back); }
  const f = contractFields(req.body);
  const missing = contracts.EDITABLE.filter((x) => x.main && !f[x.key]).map((x) => x.label);
  if (missing.length) { req.flash('error', `Please enter: ${missing.join(', ')}.`); return res.redirect(back); }
  const { body } = contracts.prepare(app, f);
  const left = contracts.unresolved(body);
  if (left.length) { req.flash('error', `The contract template has unknown fields: ${left.join(', ')}. Fix them in Settings → Contract template.`); return res.redirect(back); }
  const c = contracts.create(app, f, req.user);
  const r = await emailContract(app, c, req.user);
  audit({ applicationId: app.id, user: req.user, action: 'contract_sent', detail: `Contract #${c.id} – ${f.job_title}, ${f.pay_rate}/hr, start ${f.start_date || 'TBC'} (email ${r.status})`, ip: req.ip });
  req.flash('success', r.status === 'sent' ? 'Contract sent – the officer has been emailed a link to sign it.' : 'Contract created. Email is not configured yet, so the message is in the Outbox – the officer can also sign it from their account.');
  res.redirect(back);
});

router.post('/applications/:id/contract/:cid/resend', loadApp, async (req, res) => {
  const c = contracts.list(req.app_.id).find((x) => x.id === Number(req.params.cid) && x.status === 'sent');
  if (c) {
    const r = await emailContract(req.app_, c, req.user);
    audit({ applicationId: req.app_.id, user: req.user, action: 'contract_reminder_sent', detail: `Contract #${c.id} (email ${r.status})`, ip: req.ip });
    req.flash('success', 'Reminder sent to the officer.');
  }
  res.redirect(`/admin/applications/${req.app_.id}?tab=contract`);
});

router.post('/applications/:id/contract/:cid/void', loadApp, (req, res) => {
  const c = contracts.list(req.app_.id).find((x) => x.id === Number(req.params.cid) && x.status !== 'void');
  if (c) {
    const reason = String(req.body.reason || '').slice(0, 300) || 'Withdrawn';
    db.prepare("UPDATE contracts SET status = 'void', voided_by = ?, voided_at = datetime('now'), void_reason = ? WHERE id = ?").run(req.user.id, reason, c.id);
    audit({ applicationId: req.app_.id, user: req.user, action: 'contract_voided', detail: `Contract #${c.id}: ${reason}`, ip: req.ip });
    req.flash('success', `Contract #${c.id} withdrawn.`);
  }
  res.redirect(`/admin/applications/${req.app_.id}?tab=contract`);
});

router.get('/applications/:id/contract/:cid.pdf', loadApp, async (req, res, next) => {
  const c = contracts.list(req.app_.id).find((x) => x.id === Number(req.params.cid));
  if (!c) return next();
  audit({ applicationId: req.app_.id, user: req.user, action: 'contract_downloaded', detail: `Contract #${c.id}`, ip: req.ip });
  res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="${contracts.filename(req.app_, c)}"` });
  res.send(await contracts.pdfFor(req.app_, c));
});

// ---------------- Settings (super admin) ----------------
router.get('/settings', requireSuper, (req, res) => {
  const d = settings.get('contract_defaults');
  res.render('admin/settings', {
    title: 'Settings', tab: String(req.query.tab || 'contract'),
    defaults: d, template: settings.get('contract_template'), workflow: settings.get('workflow'),
    emails: { email_reference: settings.get('email_reference'), email_verification: settings.get('email_verification'), email_contract: settings.get('email_contract') },
    meta: Object.fromEntries(['contract_defaults', 'contract_template', 'email_reference', 'email_verification', 'email_contract', 'workflow'].map((k) => [k, settings.meta(k)])),
    EDITABLE: contracts.EDITABLE, smtp: { configured: mailer.smtpConfigured, from: config.smtp.from },
  });
});

const IMG_DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
router.post('/settings/contract-defaults', requireSuper, (req, res) => {
  const cur = settings.get('contract_defaults');
  const next = { ...cur };
  for (const k of ['job_title', 'pay_rate', 'pay_effective_from', 'probation', 'issued_by']) next[k] = String(req.body[k] || '').trim().slice(0, 200);
  const sig = req.body.issuer_signature_upload || req.body.issuer_signature;
  if (req.body.remove_signature === 'yes') next.issuer_signature = null;
  else if (sig && IMG_DATA_URL.test(sig) && sig.length < 700000) next.issuer_signature = sig;
  settings.set('contract_defaults', next, req.user.id);
  audit({ user: req.user, action: 'settings_changed', detail: 'Contract defaults', ip: req.ip });
  req.flash('success', 'Contract defaults saved.');
  res.redirect('/admin/settings?tab=contract');
});

router.post('/settings/contract-template', requireSuper, (req, res) => {
  if (req.body.reset === 'yes') settings.reset('contract_template');
  else {
    const text = String(req.body.template || '').replace(/\r/g, '');
    if (text.trim().length < 50) { req.flash('error', 'The contract template looks empty – nothing was saved.'); return res.redirect('/admin/settings?tab=template'); }
    settings.set('contract_template', text.slice(0, 200000), req.user.id);
  }
  audit({ user: req.user, action: 'settings_changed', detail: req.body.reset === 'yes' ? 'Contract template reset to original' : 'Contract template edited', ip: req.ip });
  req.flash('success', req.body.reset === 'yes' ? 'Contract template restored to the original.' : 'Contract template saved. New contracts will use it; contracts already sent are unchanged.');
  res.redirect('/admin/settings?tab=template');
});

router.post('/settings/contract-template/preview.pdf', requireSuper, async (req, res) => {
  const text = String(req.body.template || settings.get('contract_template'));
  const sample = { ref: 'SP-SAMPLE', user_id: req.user.id };
  const fields = { job_title: 'Security Officer', pay_rate: '£12.71', start_date: contracts.ukDate(), pay_effective_from: '01/04/2026', date: contracts.ukDate(), employee_ref: 'SP-SAMPLE', probation: 'six month', issued_by: settings.get('contract_defaults').issued_by };
  const v = { 'employee.full_name': 'Jane Sample', 'employee.first_name': 'Jane', 'employee.address': '1 Example Road, London, E1 1AA', 'company.legal_name': config.company.legalName, 'company.name': config.company.name, 'company.address': config.company.address.join(', '), 'company.email': config.company.email, 'company.phone': config.company.phone };
  for (const [k, val] of Object.entries(fields)) v[`contract.${k}`] = val;
  const body = settings.merge(text, v);
  const buf = await contracts.pdf({ app: { ...sample, data_enc: null }, body, fields, issuerSignature: settings.get('contract_defaults').issuer_signature, draft: true, employeeName: 'Jane Sample' });
  res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="Contract_template_preview.pdf"' });
  res.send(buf);
});

router.post('/settings/emails/:key', requireSuper, (req, res) => {
  const key = req.params.key;
  if (!['email_reference', 'email_verification', 'email_contract'].includes(key)) return res.redirect('/admin/settings?tab=emails');
  if (req.body.reset === 'yes') settings.reset(key);
  else settings.set(key, { subject: String(req.body.subject || '').slice(0, 300), body: String(req.body.body || '').replace(/\r/g, '').slice(0, 20000) }, req.user.id);
  audit({ user: req.user, action: 'settings_changed', detail: `${key}${req.body.reset === 'yes' ? ' reset' : ''}`, ip: req.ip });
  req.flash('success', 'Email template saved.');
  res.redirect(`/admin/settings?tab=emails#${key}`);
});

router.post('/settings/workflow', requireSuper, (req, res) => {
  settings.set('workflow', { auto_send_requests: req.body.auto_send_requests === 'yes' }, req.user.id);
  audit({ user: req.user, action: 'settings_changed', detail: `Auto-send reference requests: ${req.body.auto_send_requests === 'yes' ? 'on' : 'off'}`, ip: req.ip });
  req.flash('success', 'Workflow saved.');
  res.redirect('/admin/settings?tab=workflow');
});

router.post('/settings/test-email', requireSuper, async (req, res) => {
  const v = await mailer.verifyConnection();
  if (!v.ok) { req.flash('error', `Could not connect to the mail server: ${v.error}`); return res.redirect('/admin/settings?tab=workflow'); }
  const r = await mailer.send({ to: req.user.email, subject: 'Test email from the onboarding portal', title: 'Email is working',
    html: `<p>This test was sent from ${mailer.esc(config.smtp.from)} by the ${mailer.esc(config.company.name)} onboarding portal. Reference requests and contracts will be sent from this address.</p>` });
  audit({ user: req.user, action: 'test_email', detail: `${req.user.email}: ${r.status}${r.error ? ` – ${r.error}` : ''}`, ip: req.ip });
  req.flash(r.status === 'sent' ? 'success' : 'error', r.status === 'sent' ? `Test email sent to ${req.user.email} – check the inbox (and spam folder).` : `Sending failed: ${r.error}`);
  res.redirect('/admin/settings?tab=workflow');
});

// ---------------- Outbox ----------------
router.get('/emails', (req, res) => {
  res.render('admin/emails', { title: 'Email outbox', emails: db.prepare('SELECT e.id, e.to_addr, e.subject, e.status, e.error, e.created_at, a.ref, a.id AS app_id FROM emails e LEFT JOIN applications a ON a.id = e.application_id ORDER BY e.id DESC LIMIT 300').all() });
});

router.post('/emails/:id/send', async (req, res) => {
  const r = await mailer.resend(Number(req.params.id));
  const e = db.prepare('SELECT application_id, to_addr, subject FROM emails WHERE id = ?').get(req.params.id) || {};
  audit({ applicationId: e.application_id || null, user: req.user, action: 'email_resent', detail: `${e.to_addr}: ${e.subject} (${r.status})`, ip: req.ip });
  req.flash(r.status === 'sent' ? 'success' : 'error', r.status === 'sent' ? `Sent to ${e.to_addr}.` : `Not sent: ${r.error}`);
  res.redirect(req.get('referer') || '/admin/emails');
});

router.get('/emails/:id', (req, res, next) => {
  const e = db.prepare('SELECT * FROM emails WHERE id = ?').get(req.params.id);
  if (!e) return next();
  res.render('admin/email', { title: e.subject, e });
});

router.get('/emails/:id/raw', (req, res, next) => {
  const e = db.prepare('SELECT body_html FROM emails WHERE id = ?').get(req.params.id);
  if (!e) return next();
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.send(e.body_html);
});

// ---------------- Staff users (super admin) ----------------
router.get('/users', requireSuper, (req, res) => {
  res.render('admin/users', { title: 'Staff users', users: db.prepare("SELECT * FROM users WHERE role IN ('reviewer','superadmin') ORDER BY role DESC, first_name").all(), temp: null });
});

router.post('/users', requireSuper, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = req.body.role === 'superadmin' ? 'superadmin' : 'reviewer';
  if (!email || !req.body.first_name || !req.body.last_name) { req.flash('error', 'Name and email are required.'); return res.redirect('/admin/users'); }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) { req.flash('error', 'A user with that email already exists.'); return res.redirect('/admin/users'); }
  const temp = crypto.randomBytes(6).toString('base64url') + '7a';
  db.prepare('INSERT INTO users (email, password_hash, role, first_name, last_name) VALUES (?, ?, ?, ?, ?)').run(email, bcrypt.hashSync(temp, 12), role, String(req.body.first_name).trim(), String(req.body.last_name).trim());
  audit({ user: req.user, action: 'staff_created', detail: `${email} (${role})`, ip: req.ip });
  res.render('admin/users', { title: 'Staff users', users: db.prepare("SELECT * FROM users WHERE role IN ('reviewer','superadmin') ORDER BY role DESC, first_name").all(), temp: { email, password: temp } });
});

router.post('/users/:uid/toggle', requireSuper, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.uid);
  if (u && u.id !== req.user.id) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(u.active ? 0 : 1, u.id);
    audit({ user: req.user, action: u.active ? 'user_disabled' : 'user_enabled', detail: u.email, ip: req.ip });
  }
  res.redirect(req.get('referer') || '/admin/users');
});

router.post('/users/:uid/reset', requireSuper, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.uid);
  if (!u) return res.redirect('/admin/users');
  const temp = crypto.randomBytes(6).toString('base64url') + '7a';
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(temp, 12), u.id);
  audit({ user: req.user, action: 'password_reset_by_admin', detail: u.email, ip: req.ip });
  if (u.role === 'applicant') {
    const app = apps.getByUser(u.id);
    req.flash('success', `Temporary password for ${u.email}: ${temp} — share it securely with the applicant.`);
    return res.redirect(`/admin/applications/${app ? app.id : ''}`);
  }
  res.render('admin/users', { title: 'Staff users', users: db.prepare("SELECT * FROM users WHERE role IN ('reviewer','superadmin') ORDER BY role DESC, first_name").all(), temp: { email: u.email, password: temp } });
});

// ---------------- Account ----------------
router.get('/account', (req, res) => res.render('admin/account', { title: 'My account', error: null }));
router.post('/account', (req, res) => {
  const { passwordError } = require('./auth');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(req.body.current || ''), u.password_hash)) return res.render('admin/account', { title: 'My account', error: 'Current password is incorrect.' });
  const pe = passwordError(req.body.password) || (req.body.password !== req.body.password2 ? 'Passwords do not match.' : null);
  if (pe) return res.render('admin/account', { title: 'My account', error: pe });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(req.body.password, 12), u.id);
  audit({ user: req.user, action: 'password_changed', ip: req.ip });
  req.flash('success', 'Password updated.');
  res.redirect('/admin/account');
});

// ---------------- Global audit ----------------
router.get('/audit', requireSuper, (req, res) => {
  res.render('admin/audit', { title: 'Audit log', log: db.prepare('SELECT l.*, a.ref FROM audit_log l LEFT JOIN applications a ON a.id = l.application_id ORDER BY l.id DESC LIMIT 500').all() });
});

// ---------------- Diversity (aggregate only) ----------------
router.get('/insights', (req, res) => {
  const { byKey } = require('../schema');
  const fields = byKey.diversity.fields.filter((f) => f.type === 'radio');
  const agg = Object.fromEntries(fields.map((f) => [f.key, { label: f.label, counts: Object.fromEntries(f.options.map((o) => [o.label, 0])) }]));
  let n = 0;
  for (const a of db.prepare("SELECT * FROM applications WHERE status != 'in_progress'").all()) {
    const d = apps.data(a).diversity;
    if (!d) continue;
    n++;
    for (const f of fields) { const o = f.options.find((x) => x.value === d[f.key]); if (o) agg[f.key].counts[o.label]++; }
  }
  res.render('admin/insights', { title: 'Diversity monitoring', agg, n });
});

module.exports = router;
