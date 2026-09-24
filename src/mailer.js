const nodemailer = require('nodemailer');
const config = require('./config');
const { db } = require('./db');

const transport = config.smtp.host
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
  <h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
  ${bodyHtml}
</td></tr>
<tr><td style="background:#f6f8fa;padding:16px 28px;font-size:12px;color:#5b6675">
  ${esc(c.name)} · ${c.address.map(esc).join(', ')} · Tel ${esc(c.phone)}<br>
  ${esc(c.legalName)} · Company No ${esc(c.regNo)}${c.vatNo ? ` · VAT ${esc(c.vatNo)}` : ''} · ${esc(c.website)}<br>
  This email relates to security screening carried out in accordance with BS 7858:2019. It is private and confidential.
</td></tr></table></td></tr></table></body></html>`;
}

async function send({ to, subject, title, html, applicationId = null }) {
  const body = layout(title || subject, html);
  let status = 'queued';
  let error = null;
  if (transport) {
    try {
      await transport.sendMail({ from: config.smtp.from, to, subject, html: body, replyTo: config.company.email });
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

module.exports = { send, esc, smtpConfigured: !!transport };
