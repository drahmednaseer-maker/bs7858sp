// Public, token-protected pages where employers / referees respond to verification requests.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, audit } = require('../db');
const { encrypt } = require('../crypto');
const apps = require('../apps');
const mailer = require('../mailer');
const config = require('../config');

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 60 }));

function load(req, res, next) {
  const t = String(req.params.token || '');
  const v = /^[a-f0-9]{48}$/.test(t) ? db.prepare('SELECT * FROM verifications WHERE token = ?').get(t) : null;
  if (!v) return res.status(404).render('error', { title: 'Link not valid', message: 'This verification link is not valid or has been withdrawn. Please contact us if you need help.' });
  req.v = v;
  req.app_ = apps.get(v.application_id);
  next();
}

// Questions follow the company's standard reference letter, plus the BS 7858 suitability question.
const RATING = ['Excellent', 'Good', 'Satisfactory', 'Poor', 'Unable to comment'];
const LETTER_QUESTIONS = [
  { key: 'dates_from', label: 'Dates of employment – from (month & year)', type: 'month', required: true },
  { key: 'dates_to', label: 'Dates of employment – to (month & year, blank if current)', type: 'month' },
  { key: 'job_title', label: 'Job title / position held', required: true },
  { key: 'duties', label: 'Main duties and responsibilities', type: 'textarea', required: true },
  { key: 'reliability', label: 'Reliability and attendance', type: 'select', options: RATING, required: true },
  { key: 'conduct', label: 'Conduct and professionalism', type: 'select', options: RATING, required: true },
  { key: 'security_quals', label: 'Any relevant security qualifications or experience', type: 'textarea' },
  { key: 'suitable', label: 'Would you consider the individual suitable for future employment?', type: 'select', options: ['Yes', 'No', 'Company policy not to say'], required: true },
  { key: 'concerns', label: 'Are you aware of any reason why this person should not be employed in a position of trust in a secure environment?', type: 'select', options: ['No', 'Yes'], required: true },
  { key: 'comments', label: 'Any other comments', type: 'textarea' },
];
const FIELDS = {
  history: [
    { key: 'respondent_name', label: 'Your name', required: true },
    { key: 'respondent_position', label: 'Your position', required: true },
    { key: 'organisation', label: 'Organisation', required: true },
    { key: 'respondent_phone', label: 'Telephone' },
    ...LETTER_QUESTIONS.slice(0, 4),
    { key: 'reason_leaving', label: 'Reason for leaving' },
    ...LETTER_QUESTIONS.slice(4),
  ],
  reference: [
    { key: 'respondent_name', label: 'Your name', required: true },
    { key: 'respondent_position', label: 'Your position / occupation', required: true },
    { key: 'organisation', label: 'Organisation', required: true },
    { key: 'respondent_phone', label: 'Telephone' },
    { key: 'relationship', label: 'Your relationship to the applicant (e.g. line manager)', required: true },
    ...LETTER_QUESTIONS,
  ],
};

router.get('/:token', load, (req, res) => {
  const v = req.v;
  res.render('referee', {
    title: v.kind === 'reference' ? 'Reference request' : 'Verification request',
    v, fields: FIELDS[v.kind], name: apps.applicantName(req.app_), values: {}, errors: {}, done: !!v.responded_at,
  });
});

router.post('/:token', load, async (req, res) => {
  const v = req.v;
  if (v.responded_at) return res.redirect(`/r/${req.params.token}`);
  const fields = FIELDS[v.kind];
  const values = {}; const errors = {};
  for (const f of fields) {
    let val = String(req.body[f.key] || '').trim().slice(0, 3000);
    if (f.type === 'select' && val && !f.options.includes(val)) val = '';
    if (f.type === 'month' && val && !/^\d{4}-\d{2}$/.test(val)) { errors[f.key] = 'Use month and year.'; }
    if (f.required && !val) errors[f.key] = 'Required';
    values[f.key] = val;
  }
  if (req.body.declare !== 'yes') errors.declare = 'Please confirm the declaration.';
  if (Object.keys(errors).length) return res.status(400).render('referee', { title: 'Verification request', v, fields, name: apps.applicantName(req.app_), values, errors, done: false });
  const labelled = {};
  for (const f of fields) labelled[f.key] = values[f.key];
  labelled.declaration = 'Confirmed accurate to the best of the respondent\'s knowledge';
  labelled.respondent_ip = req.ip;
  db.prepare(`UPDATE verifications SET response_enc = ?, responded_at = datetime('now'), status = 'received',
    confirmed_from = COALESCE(confirmed_from, ?), confirmed_to = COALESCE(confirmed_to, ?) WHERE id = ?`)
    .run(encrypt(labelled), values.dates_from || null, values.dates_to || null, v.id);
  audit({ applicationId: v.application_id, action: 'verification_response_received', detail: `${v.label} – from ${values.respondent_name}${values.concerns === 'Yes' ? ' – CONCERNS RAISED' : ''}`, ip: req.ip, actor: `Referee: ${values.respondent_name}` });
  mailer.send({
    to: config.company.email, applicationId: v.application_id,
    subject: `[Screening] Response received – ${req.app_.ref}${values.concerns === 'Yes' ? ' – CONCERNS RAISED' : ''}`,
    title: 'Verification response received',
    html: `<p>A response has been received for <strong>${mailer.esc(v.label)}</strong> (application ${req.app_.ref}).</p><p><a href="${config.baseUrl}/admin/applications/${v.application_id}?tab=verification">Review it in the portal</a></p>`,
  }).catch(() => {});
  res.render('referee', { title: 'Thank you', v, fields, name: apps.applicantName(req.app_), values, errors: {}, done: true });
});

// Human-readable question labels for displaying responses (admin screen + PDF).
const LABELS = { declaration: 'Declaration', respondent_ip: 'Respondent IP address' };
for (const list of Object.values(FIELDS)) for (const f of list) LABELS[f.key] = LABELS[f.key] || f.label;
router.labelFor = (k) => LABELS[k] || k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

module.exports = router;
