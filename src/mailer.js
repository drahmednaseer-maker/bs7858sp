const nodemailer = require('nodemailer');
const config = require('./config');
const { db } = require('./db');

// Only send once the server AND (if a username is set) its password are configured – otherwise
// emails are kept in the Outbox rather than failing.
const transport = config.smtp.host && (!config.smtp.user || config.smtp.pass)
  ? nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  })
  : null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, bodyHtml) {
  const c = config.company;
  return `<!doctype html><html><body style="margin:0;background:#eef2f7;font-family:Segoe UI,Arial,sans-serif;color:#1b2a3a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:600px">
<tr><td style="background:#ffffff;padding:18px 28px;border-bottom:4px solid #0c2547">
  <img src="${config.baseUrl}/img/sp-logo-white.jpg" width="180" alt="${esc(c.name)}" style="display:block;height:auto"></td></tr>
<tr><td style="padding:28px">
  ${title ? `<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>` : ''}
  ${bodyHtml}
</td></tr>
<tr><td style="background:#f6f8fa;padding:16px 28px;font-size:12px;color:#5b6675">
  ${esc(c.name)} · ${c.address.map(esc).join(', ')} · Tel ${esc(c.phone)}<br>
  ${esc(c.legalName)} · Company No ${esc(c.regNo)}${c.vatNo ? ` · VAT ${esc(c.vatNo)}` : ''} · ${esc(c.website)}<br>
  This email relates to security screening carried out in accordance with BS 7858:2019. It is private and confidential.
</td></tr></table></td></tr></table></body></html>`;
}

// Turn an admin-editable plain-text template into email HTML. A line containing only a {{…_link}}
// placeholder becomes a button; "- " lines become a bulleted list; blank lines separate paragraphs.
function renderTemplate(text, vars, buttons = {}) {
  const { merge } = require('./settings');
  const out = [];
  for (const para of String(text || '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const btn = lines.length === 1 && lines[0].match(/^\{\{\s*(\w+_link)\s*\}\}$/);
    if (btn && buttons[btn[1]]) {
      const b = buttons[btn[1]];
      out.push(`<p style="margin:20px 0"><a href="${esc(b.url)}" style="background:#0c2547;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">${esc(b.label)}</a></p>`);
      continue;
    }
    const linkVars = Object.fromEntries(Object.entries(buttons).map(([k, b]) => [k, b.url]));
    const all = { ...vars, ...linkVars };
    if (lines.every((l) => /^[-•]\s+/.test(l))) {
      out.push(`<ul style="margin:0 0 14px;padding-left:20px">${lines.map((l) => `<li style="margin-bottom:4px">${esc(merge(l.replace(/^[-•]\s+/, ''), all))}</li>`).join('')}</ul>`);
    } else {
      out.push(`<p style="margin:0 0 14px;line-height:1.55">${lines.map((l) => esc(merge(l, all))).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}

async function send({ to, subject, title, html, applicationId = null, attachments = [] }) {
  const body = layout(title === '' ? '' : (title || subject), html); // title '' = letter-style email with no heading
  let status = 'queued';
  let error = null;
  if (transport) {
    try {
      await transport.sendMail({ from: config.smtp.from, to, subject, html: body, replyTo: config.company.email, attachments });
      status = 'sent';
    } catch (e) {
      status = 'failed';
      error = e.message;
      console.error('Email failed:', e.message);
    }
  } else {
    console.log(`[email not sent – SMTP not configured] To: ${to} | ${subject}`);
  }
  const r = db.prepare('INSERT INTO emails (application_id, to_addr, subject, body_html, status, error) VALUES (?, ?, ?, ?, ?, ?)')
    .run(applicationId, to, subject, body, status, error);
  return { id: Number(r.lastInsertRowid), status, error };
}

async function verifyConnection() {
  if (!transport) return { ok: false, error: 'Email sending is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS).' };
  try { await transport.verify(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

// Send an email that was stored in the Outbox (e.g. queued before email sending was set up).
async function resend(id) {
  const e = db.prepare('SELECT * FROM emails WHERE id = ?').get(id);
  if (!e) return { status: 'failed', error: 'Not found' };
  if (!transport) return { status: 'queued', error: 'Email sending is not configured.' };
  try {
    await transport.sendMail({ from: config.smtp.from, to: e.to_addr, subject: e.subject, html: e.body_html, replyTo: config.company.email });
    db.prepare("UPDATE emails SET status = 'sent', error = NULL WHERE id = ?").run(id);
    return { status: 'sent' };
  } catch (err) {
    db.prepare("UPDATE emails SET status = 'failed', error = ? WHERE id = ?").run(err.message, id);
    return { status: 'failed', error: err.message };
  }
}

module.exports = { send, resend, esc, renderTemplate, verifyConnection, smtpConfigured: !!transport };
