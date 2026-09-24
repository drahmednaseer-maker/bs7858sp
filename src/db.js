const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const config = require('./config');

const db = new DatabaseSync(path.join(config.dataDir, 'onboarding.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'applicant',          -- applicant | reviewer | superadmin
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  reset_token TEXT,
  reset_expires INTEGER,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  data_enc TEXT,                                   -- AES-GCM encrypted JSON of all section answers
  sections TEXT NOT NULL DEFAULT '{}',             -- { sectionKey: 'complete' | 'draft' }
  admin_enc TEXT,                                  -- encrypted admin-only data (employer comments, countersignatures, authorisation)
  assigned_to INTEGER REFERENCES users(id),
  submitted_at TEXT,
  screening_started_at TEXT,
  decision_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | pass | fail | refer | na
  reference TEXT,
  notes TEXT,
  checked_by INTEGER REFERENCES users(id),
  checked_at TEXT,
  UNIQUE(application_id, type)
);

CREATE TABLE IF NOT EXISTS verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                              -- history | reference
  source_key TEXT NOT NULL,                        -- e.g. history:0, reference:1
  label TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  code TEXT,                                       -- WR, ER, CL, AR, DR, SDR, TR, FI
  status TEXT NOT NULL DEFAULT 'not_sent',         -- not_sent | sent | chased | received | verified | unable
  token TEXT UNIQUE,
  sent_at TEXT,
  chased_at TEXT,
  response_enc TEXT,
  responded_at TEXT,
  confirmed_from TEXT,
  confirmed_to TEXT,
  notes TEXT,
  updated_by INTEGER REFERENCES users(id),
  UNIQUE(application_id, source_key)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  actor TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL,                            -- sent | queued (no SMTP) | failed
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`);

// Seed / refresh the super admin from environment.
(function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(config.admin.email);
  if (!existing) {
    const [first, ...rest] = config.admin.name.split(' ');
    db.prepare(`INSERT INTO users (email, password_hash, role, first_name, last_name) VALUES (?, ?, 'superadmin', ?, ?)`)
      .run(config.admin.email, bcrypt.hashSync(config.admin.password, 12), first, rest.join(' ') || 'Admin');
    console.log(`Seeded super admin: ${config.admin.email}`);
  }
  if (config.isProd && !process.env.ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD is not set – the default super admin password is in use. Set it and change it after first sign-in.');
})();

function audit({ applicationId = null, user = null, action, detail = null, ip = null, actor = null }) {
  db.prepare('INSERT INTO audit_log (application_id, user_id, actor, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(applicationId, user ? user.id : null, actor || (user ? `${user.first_name} ${user.last_name}` : 'System'), action, detail, ip);
}

module.exports = { db, audit };
