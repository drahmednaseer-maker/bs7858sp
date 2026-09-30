// Sending history-verification and reference requests (from admin, or automatically on submission).
const { db, audit } = require('./db');
const { token } = require('./crypto');
const apps = require('./apps');
const mailer = require('./mailer');
const settings = require('./settings');
const config = require('./config');

function requestEmail(app, v) {
  const tpl = settings.get(v.kind === 'reference' ? 'email_reference' : 'email_verification');
  const vars = {
    'referee.name': v.contact_name || 'Sir or Madam',
    'employee.full_name': apps.applicantName(app),
    period: v.label.replace(/^Reference \d+ – /, ''),
    'company.email': config.company.email,
    'company.legal_name': config.company.legalName,
  };
  const buttons = { response_link: { url: `${config.baseUrl}/r/${v.token}`, label: v.kind === 'reference' ? 'Complete the reference online' : 'Confirm the details online' } };
  return { subject: settings.merge(tpl.subject, vars), html: mailer.renderTemplate(tpl.body, vars, buttons) };
}

// user = staff member sending (null when automatic). Returns { ok, status, msg }.
async function sendRequest(app, v, { user = null, ip = null } = {}) {
  if (!v.contact_email) return { ok: false, msg: `${v.label}: no email address.` };
  const t = v.token || token(24);
  if (!v.token) db.prepare('UPDATE verifications SET token = ? WHERE id = ?').run(t, v.id);
  const mail = requestEmail(app, { ...v, token: t });
  const r = await mailer.send({ to: v.contact_email, applicationId: app.id, subject: mail.subject, title: '', html: mail.html });
  const chase = ['sent', 'chased'].includes(v.status);
  db.prepare(`UPDATE verifications SET status = ?, ${chase ? "chased_at = datetime('now')" : "sent_at = datetime('now')"}, updated_by = ? WHERE id = ?`)
    .run(chase ? 'chased' : 'sent', user ? user.id : null, v.id);
  audit({ applicationId: app.id, user, actor: user ? null : 'System (automatic)', action: chase ? 'verification_chased' : 'verification_sent', detail: `${v.label} → ${v.contact_email} (${r.status})`, ip });
  const fresh = apps.get(app.id);
  if (fresh.status === 'submitted') apps.setStatus(fresh, 'under_review');
  return { ok: true, status: r.status };
}

async function sendAllUnsent(app, opts = {}) {
  const list = db.prepare("SELECT * FROM verifications WHERE application_id = ? AND status = 'not_sent'").all(app.id);
  let sent = 0; const skipped = [];
  for (const v of list) { const r = await sendRequest(app, v, opts); if (r.ok) sent++; else skipped.push(v.label); }
  return { sent, skipped };
}

module.exports = { sendRequest, sendAllUnsent, requestEmail };
