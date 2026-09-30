// Admin-editable settings: contract template & defaults, email templates, workflow switches.
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const DEFAULT_REFERENCE_EMAIL = {
  subject: 'Reference request – {{employee.full_name}}',
  body: `Dear {{referee.name}},

I hope you are well.

I am writing on behalf of Security Projects Ltd to request a personnel/employment reference for {{employee.full_name}}, who has worked with your organisation.

As part of our recruitment and compliance process, we would be grateful if you could confirm the following details:

- Dates of employment
- Job title/position held
- Main duties and responsibilities
- Reliability and attendance
- Conduct and professionalism
- Any relevant security qualifications or experience
- Whether you would consider the individual suitable for future employment

The quickest way to respond is our short secure online form:

{{response_link}}

Alternatively, you are welcome to reply to this email.

Any information provided will be treated confidentially and used solely for our recruitment and personnel vetting purposes.

We would appreciate your assistance and, if possible, a response at your earliest convenience.

Kind regards,

Security Projects Ltd
Email: {{company.email}}`,
};

const DEFAULT_VERIFICATION_EMAIL = {
  subject: 'Employment / history verification – {{employee.full_name}}',
  body: `Dear {{referee.name}},

I hope you are well.

I am writing on behalf of Security Projects Ltd. {{employee.full_name}} has applied to work with us and has given your details to confirm the following period of their history:

{{period}}

As a security company we are required to screen all staff in accordance with British Standard BS 7858:2019, and the applicant has signed a Letter of Authority permitting us to contact you. We would be grateful if you could confirm the dates, the job title/position held, and the main duties and responsibilities.

The quickest way to respond is our short secure online form:

{{response_link}}

Alternatively, you are welcome to reply to this email.

Any information provided will be treated confidentially and used solely for our recruitment and personnel vetting purposes.

Kind regards,

Security Projects Ltd
Email: {{company.email}}`,
};

const DEFAULT_CONTRACT_EMAIL = {
  subject: 'Your contract of employment – {{company.legal_name}}',
  body: `Dear {{employee.first_name}},

Congratulations – your contract of employment with {{company.legal_name}} is ready for you to review and sign electronically.

Position: {{contract.job_title}}
Start date: {{contract.start_date}}

Please sign in to your onboarding account to read and sign it:

{{contract_link}}

If you have any questions about your contract, simply reply to this email.

Kind regards,

Security Projects Ltd
Email: {{company.email}}`,
};

const DEFAULTS = {
  contract_template: () => fs.readFileSync(path.join(__dirname, 'templates', 'contract-variable-hours.txt'), 'utf8'),
  contract_defaults: () => ({
    job_title: 'Security Officer',
    pay_rate: '£12.71',
    pay_effective_from: '01/04/2026',
    probation: 'six month',
    issued_by: 'James Hue',
    issuer_signature: null, // PNG data URL, uploaded/drawn in Settings
  }),
  email_reference: () => DEFAULT_REFERENCE_EMAIL,
  email_verification: () => DEFAULT_VERIFICATION_EMAIL,
  email_contract: () => DEFAULT_CONTRACT_EMAIL,
  workflow: () => ({ auto_send_requests: false }),
};

function get(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  const def = DEFAULTS[key] ? DEFAULTS[key]() : null;
  if (!row) return def;
  const v = JSON.parse(row.value);
  return def && typeof def === 'object' && !Array.isArray(def) ? { ...def, ...v } : v;
}

function set(key, value, userId) {
  db.prepare(`INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(key, JSON.stringify(value), userId || null);
}

function reset(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

function meta(key) {
  return db.prepare(`SELECT s.updated_at, u.first_name || ' ' || u.last_name AS by_name FROM settings s LEFT JOIN users u ON u.id = s.updated_by WHERE key = ?`).get(key) || null;
}

// {{a.b}} merge – unknown fields are left visible so mistakes are obvious in previews.
function merge(text, vars) {
  return String(text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

module.exports = { get, set, reset, meta, merge, DEFAULTS };
