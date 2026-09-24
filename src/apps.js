// Application data access & screening domain logic.
const { db } = require('./db');
const { encrypt, decrypt } = require('./crypto');
const { sections, byKey } = require('./schema');
const config = require('./config');
const { fmtMonth } = require('./timeline');

const STATUSES = {
  in_progress: { label: 'In progress', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'info' },
  under_review: { label: 'Under review', tone: 'info' },
  info_requested: { label: 'Information requested', tone: 'warn' },
  provisional: { label: 'Provisionally cleared', tone: 'warn' },
  cleared: { label: 'Cleared', tone: 'good' },
  rejected: { label: 'Not cleared', tone: 'bad' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

const CHECK_TYPES = [
  { type: 'identity', label: 'Identity verified', guidance: 'Original photo ID (passport / driving licence) seen and compared with the applicant in person or via certified digital identity service. Copy retained.', docs: ['passport_files', 'driving_licence_files', 'photo_files'] },
  { type: 'address', label: 'Proof of address', guidance: 'Two proofs of address checked – bank statement / utility bill within 3 months, council tax / driving licence within current year.', docs: ['poa_1_files', 'poa_2_files'] },
  { type: 'rtw', label: 'Right to work', guidance: 'Check the share code using the Home Office online service, or check original documents (List A/B). Save the result PDF as evidence.', link: 'rtw', docs: ['rtw_files'] },
  { type: 'sia', label: 'SIA licence', guidance: 'Search the SIA Register of Licence Holders by the 16-digit licence number. Confirm status is Active, sector and expiry.', link: 'sia', docs: ['sia_files'] },
  { type: 'sanctions', label: 'UK sanctions list', guidance: 'Search the applicant\'s full name (and any previous names) on the FCDO UK Sanctions List. Record "No match" and the date searched.', link: 'sanctions' },
  { type: 'dbs', label: 'Criminal record (Basic DBS)', guidance: 'Basic DBS certificate obtained or checked on the DBS Update Service. Record certificate number and issue date.', link: 'dbs', docs: ['dbs_files'] },
  { type: 'credit', label: 'Consumer information / credit check', guidance: 'Financial / consumer information search through a credit reference agency covering the 5-year address history. Record any CCJs, bankruptcy or IVAs.' },
  { type: 'history', label: '5-year history verified', guidance: 'Every period of the 5-year history verified in writing (employer / education / DWP / accountant) or by statutory declaration where unavoidable.' },
  { type: 'references', label: 'References', guidance: 'Written references received and reviewed.' },
  { type: 'interview', label: 'Pre-employment interview', guidance: 'Face-to-face (or live video) interview conducted to clarify the application and any gaps.' },
];

const VERIFICATION_STATUSES = {
  not_sent: 'Not sent', sent: 'Request sent', chased: 'Chased', received: 'Response received', verified: 'Verified', unable: 'Unable to verify',
};

const LETTER_CODES = {
  WR: 'Work reference', ER: 'Education reference', AR: "Accountant's reference", DR: 'Documentation request',
  SDR: 'Statutory declaration request', TR: 'Trade reference', CL: 'Chaser letter', FI: 'Further information request',
};

function newRef() {
  const year = new Date().getFullYear();
  const n = db.prepare("SELECT COUNT(*) AS n FROM applications WHERE ref LIKE ?").get(`SP-${year}-%`).n + 1;
  return `SP-${year}-${String(n).padStart(4, '0')}`;
}

function createForUser(userId) {
  const r = db.prepare('INSERT INTO applications (ref, user_id, data_enc) VALUES (?, ?, ?)').run(newRef(), userId, encrypt({}));
  return get(Number(r.lastInsertRowid));
}

function get(id) {
  return db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
}

function getByUser(userId) {
  return db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);
}

const data = (app) => decrypt(app.data_enc);
const adminData = (app) => (app.admin_enc ? decrypt(app.admin_enc) : {});
const sectionState = (app) => JSON.parse(app.sections || '{}');

function saveSection(app, key, sectionData, complete) {
  const all = data(app);
  all[key] = sectionData;
  const st = sectionState(app);
  st[key] = complete ? 'complete' : 'draft';
  db.prepare("UPDATE applications SET data_enc = ?, sections = ?, updated_at = datetime('now') WHERE id = ?")
    .run(encrypt(all), JSON.stringify(st), app.id);
}

function saveAdmin(app, patch) {
  const a = { ...adminData(app), ...patch };
  db.prepare("UPDATE applications SET admin_enc = ?, updated_at = datetime('now') WHERE id = ?").run(encrypt(a), app.id);
}

function setStatus(app, status) {
  const extra = ['cleared', 'rejected', 'provisional'].includes(status) ? ", decision_at = datetime('now')" : '';
  db.prepare(`UPDATE applications SET status = ?, updated_at = datetime('now')${extra} WHERE id = ?`).run(status, app.id);
}

function docs(appId) {
  return db.prepare('SELECT * FROM documents WHERE application_id = ? ORDER BY id').all(appId);
}

function docCounts(appId) {
  const out = {};
  for (const d of db.prepare('SELECT field_key, COUNT(*) AS n FROM documents WHERE application_id = ? GROUP BY field_key').all(appId)) out[d.field_key] = d.n;
  return out;
}

function progress(app) {
  const st = sectionState(app);
  const done = sections.filter((s) => st[s.key] === 'complete').length;
  return { done, total: sections.length, pct: Math.round((done / sections.length) * 100) };
}

function deadline(app) {
  if (!app.screening_started_at) return null;
  const start = new Date(app.screening_started_at.replace(' ', 'T') + 'Z');
  const due = new Date(start.getTime() + config.screening.completionWeeks * 7 * 86400000);
  const daysLeft = Math.ceil((due - Date.now()) / 86400000);
  return { due, daysLeft };
}

function applicantName(app) {
  const d = data(app);
  const a = d.application || {};
  if (a.forenames || a.surname) return `${a.forenames || ''} ${a.surname || ''}`.trim();
  const u = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(app.user_id);
  return u ? `${u.first_name} ${u.last_name}` : 'Unknown';
}

// Keep verification rows in step with the applicant's history & references.
function syncVerifications(app) {
  const d = data(app).application || {};
  const typeCode = { employment: 'WR', self_employment: 'AR', full_time_education: 'ER', unemployment: 'DR' };
  const wanted = [];
  for (const h of d.history || []) {
    if (!h || !h._id) continue;
    const period = `${fmtMonth(h.from)} – ${h.current === 'yes' ? 'Present' : fmtMonth(h.to)}`;
    const typeLabel = (byKey.application.fields.find((f) => f.key === 'history').fields[0].options.find((o) => o.value === h.type) || {}).label || h.type;
    wanted.push({
      source_key: `history:${h._id}`, kind: 'history',
      label: `${typeLabel}${h.org_name ? ` – ${h.org_name}` : ''} (${period})`,
      contact_name: h.contact_name || null, contact_email: h.contact_email || null, code: typeCode[h.type] || 'DR',
    });
  }
  (d.references || []).forEach((r, i) => {
    if (!r || !r._id) return;
    wanted.push({ source_key: `reference:${r._id}`, kind: 'reference', label: `Reference ${i + 1} – ${r.name || ''}${r.company ? ` (${r.company})` : ''}`, contact_name: r.name || null, contact_email: r.email || null, code: 'WR' });
  });
  const existing = Object.fromEntries(db.prepare('SELECT * FROM verifications WHERE application_id = ?').all(app.id).map((v) => [v.source_key, v]));
  const ins = db.prepare('INSERT INTO verifications (application_id, kind, source_key, label, contact_name, contact_email, code) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const upd = db.prepare('UPDATE verifications SET label = ?, contact_name = ?, contact_email = ? WHERE id = ?');
  for (const w of wanted) {
    const e = existing[w.source_key];
    if (!e) ins.run(app.id, w.kind, w.source_key, w.label, w.contact_name, w.contact_email, w.code);
    else if (e.status === 'not_sent') upd.run(w.label, w.contact_name, w.contact_email, e.id);
  }
  // Remove rows for deleted entries that were never actioned.
  const keys = new Set(wanted.map((w) => w.source_key));
  for (const e of Object.values(existing)) if (!keys.has(e.source_key) && e.status === 'not_sent') db.prepare('DELETE FROM verifications WHERE id = ?').run(e.id);
}

function ensureChecks(appId) {
  const ins = db.prepare('INSERT OR IGNORE INTO checks (application_id, type) VALUES (?, ?)');
  for (const c of CHECK_TYPES) ins.run(appId, c.type);
}

function checks(appId) {
  ensureChecks(appId);
  const rows = Object.fromEntries(db.prepare(`SELECT c.*, u.first_name || ' ' || u.last_name AS checker FROM checks c LEFT JOIN users u ON u.id = c.checked_by WHERE application_id = ?`).all(appId).map((r) => [r.type, r]));
  return CHECK_TYPES.map((t) => ({ ...t, ...rows[t.type], linkInfo: t.link ? config.checkLinks[t.link] : null }));
}

function verifications(appId) {
  return db.prepare(`SELECT v.*, u.first_name || ' ' || u.last_name AS updater FROM verifications v LEFT JOIN users u ON u.id = v.updated_by WHERE application_id = ? ORDER BY kind, id`).all(appId);
}

module.exports = {
  STATUSES, CHECK_TYPES, VERIFICATION_STATUSES, LETTER_CODES,
  createForUser, get, getByUser, data, adminData, sectionState, saveSection, saveAdmin, setStatus,
  docs, docCounts, progress, deadline, applicantName, syncVerifications, checks, verifications, ensureChecks,
};
