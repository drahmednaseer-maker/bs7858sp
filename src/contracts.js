// Contracts of employment: prepared from the editable template + applicant data, e-signed by the officer.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const config = require('./config');
const { db } = require('./db');
const { encrypt, decrypt, encryptBuffer, decryptBuffer } = require('./crypto');
const settings = require('./settings');
const apps = require('./apps');

db.exec(`CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'sent',              -- sent | signed | void
  fields_enc TEXT NOT NULL,                         -- merge values used (encrypted)
  body TEXT NOT NULL,                               -- contract text frozen at the time of sending
  issuer_signature TEXT,                            -- employer signature image (data URL)
  sent_by INTEGER REFERENCES users(id),
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  viewed_at TEXT,
  signed_at TEXT,
  signature_enc TEXT,                               -- employee signature + typed name + IP (encrypted)
  pdf_name TEXT,                                    -- signed PDF (encrypted on disk)
  voided_by INTEGER REFERENCES users(id),
  voided_at TEXT,
  void_reason TEXT
)`);

const LOGO = path.join(__dirname, '..', 'public', 'img', 'sp-group-logo.png');
const pad = (n) => String(n).padStart(2, '0');
const ukDate = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year}`;
};
const isoToUk = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s.split('-').reverse().join('/') : s || '');

// Fields staff can change per contract (the yellow-highlighted parts of the Word contract).
const EDITABLE = [
  { key: 'job_title', label: 'Position / job title', main: true },
  { key: 'pay_rate', label: 'Hourly rate of pay', main: true, placeholder: '£12.71' },
  { key: 'start_date', label: 'Start date' },
  { key: 'pay_effective_from', label: 'Rate effective from' },
  { key: 'date', label: 'Contract date' },
  { key: 'employee_ref', label: 'Employee reference' },
  { key: 'probation', label: 'Probationary period' },
  { key: 'issued_by', label: 'Issued by (for Employer)' },
];

function employeeOf(app) {
  const all = apps.data(app);
  const a = all.application || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(app.user_id) || {};
  const first = a.forenames || u.first_name || '';
  const last = a.surname || u.last_name || '';
  return {
    full_name: `${first} ${last}`.trim(),
    first_name: first.split(' ')[0] || first,
    address: [a.address, a.postcode].filter(Boolean).join(', ').replace(/\s*\n\s*/g, ', '),
    email: u.email,
    position: a.position || '',
    hmrcStart: (all.hmrc || {}).start_date || '',
  };
}

// Values pre-filled when staff press "Prepare contract": everything except position and rate is automatic.
function autoFields(app) {
  const d = settings.get('contract_defaults');
  const emp = employeeOf(app);
  const auth = apps.adminData(app).authorisation || {};
  const start = (auth.confirmed && auth.confirmed.start_date) || (auth.conditional && auth.conditional.start_date) || emp.hmrcStart;
  return {
    job_title: emp.position || d.job_title || 'Security Officer',
    pay_rate: d.pay_rate || '',
    start_date: start ? isoToUk(start) : '',
    pay_effective_from: d.pay_effective_from || '',
    date: ukDate(),
    employee_ref: app.ref,
    probation: d.probation || 'six month',
    issued_by: d.issued_by || '',
  };
}

function vars(app, fields) {
  const emp = employeeOf(app);
  const c = config.company;
  const v = {
    'employee.full_name': emp.full_name, 'employee.first_name': emp.first_name, 'employee.address': emp.address,
    'company.legal_name': c.legalName, 'company.name': c.name, 'company.address': c.address.join(', '), 'company.email': c.email, 'company.phone': c.phone,
  };
  for (const [k, val] of Object.entries(fields)) v[`contract.${k}`] = val || '';
  return v;
}

// Template markup: "# Title", "## Heading", "- bullet", "**Label:** value", blank line = new paragraph.
function blocks(text) {
  const out = [];
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^#\s+(.*)$/))) out.push({ t: 'h1', text: m[1] });
    else if ((m = line.match(/^##\s+(.*)$/))) out.push({ t: 'h2', text: m[1] });
    else if ((m = line.match(/^[-•]\s+(.*)$/))) out.push({ t: 'li', text: m[1] });
    else if ((m = line.match(/^\*\*(.+?)\*\*\s*(.*)$/))) out.push({ t: 'kv', label: m[1], text: m[2] });
    else out.push({ t: 'p', text: line });
  }
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function html(body) {
  let out = ''; let inList = false;
  for (const b of blocks(body)) {
    if (b.t !== 'li' && inList) { out += '</ul>'; inList = false; }
    if (b.t === 'h1') out += `<h1>${esc(b.text)}</h1>`;
    else if (b.t === 'h2') out += `<h2>${esc(b.text)}</h2>`;
    else if (b.t === 'kv') out += `<p class="kv-line"><b>${esc(b.label)}</b> ${esc(b.text)}</p>`;
    else if (b.t === 'li') { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${esc(b.text)}</li>`; } else out += `<p>${esc(b.text)}</p>`;
  }
  if (inList) out += '</ul>';
  return out;
}

function unresolved(body) {
  return [...new Set((String(body).match(/\{\{\s*[\w.]+\s*\}\}/g) || []).map((x) => x.replace(/\s/g, '')))];
}

function prepare(app, fields) {
  const clean = {};
  for (const f of EDITABLE) clean[f.key] = String(fields[f.key] ?? '').trim().slice(0, 200);
  return { fields: clean, body: settings.merge(settings.get('contract_template'), vars(app, clean)) };
}

// ---------- PDF ----------
async function pdf({ app, body, fields, issuerSignature, signature, contractId, draft, employeeName }) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 64, left: 56, right: 56 }, bufferPages: true, info: { Title: `Contract of employment – ${app.ref}`, Author: config.company.legalName } });
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', r));
  const W = doc.page.width - 112;
  const ensure = (h) => { if (doc.y + h > doc.page.height - 80) doc.addPage(); };
  try { doc.image(LOGO, 56, 36, { width: 190 }); } catch { /* */ }
  doc.y = 100;
  if (draft) doc.save().fillColor('#c62828').font('Helvetica-Bold').fontSize(9).text('DRAFT – NOT YET SENT', 56, 44, { width: W, align: 'right' }).restore();
  let listIdx = 0;
  for (const b of blocks(body)) {
    if (b.t !== 'li') listIdx = 0;
    if (b.t === 'h1') { ensure(40); doc.moveDown(0.3).font('Helvetica-Bold').fontSize(15).fillColor('#0c2547').text(b.text, 56, doc.y, { width: W }); doc.moveDown(0.5); }
    else if (b.t === 'h2') { ensure(36); doc.moveDown(0.6).font('Helvetica-Bold').fontSize(10.5).fillColor('#0c2547').text(b.text, 56, doc.y, { width: W }); doc.moveDown(0.25); }
    else if (b.t === 'kv') { ensure(16); doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1b2a3a').text(`${b.label} `, 56, doc.y, { width: W, continued: true }).font('Helvetica').text(b.text || '—'); doc.moveDown(0.15); }
    else if (b.t === 'li') { ensure(16); listIdx++; doc.font('Helvetica').fontSize(9.5).fillColor('#1b2a3a').text(`•  ${b.text}`, 70, doc.y, { width: W - 14 }); doc.moveDown(0.15); }
    else { ensure(20); doc.font('Helvetica').fontSize(9.5).fillColor('#1b2a3a').text(b.text, 56, doc.y, { width: W, align: 'justify' }); doc.moveDown(0.45); }
  }
  // Signature block
  ensure(230);
  doc.moveDown(1.2); // the acknowledgement sentence is part of the editable template, so it isn't repeated here
  const colW = (W - 24) / 2; const top = doc.y;
  const sigBox = (x, title, name, sub, img, when, extra) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0c2547').text(title, x, top, { width: colW });
    doc.rect(x, top + 16, colW, 70).lineWidth(0.6).strokeColor('#cbd5e1').stroke();
    if (img) { try { doc.image(Buffer.from(img.split(',')[1], 'base64'), x + 6, top + 20, { fit: [colW - 12, 62], align: 'center', valign: 'center' }); } catch { /* */ } }
    else doc.font('Helvetica-Oblique').fontSize(9).fillColor('#9aa6b4').text('Awaiting signature', x, top + 46, { width: colW, align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#1b2a3a').text(`Name: ${name || '—'}`, x, top + 92, { width: colW });
    if (sub) doc.text(sub, x, doc.y, { width: colW });
    doc.text(`Date: ${when || '—'}`, x, doc.y, { width: colW });
    if (extra) doc.font('Helvetica').fontSize(7.5).fillColor('#6b7a8c').text(extra, x, doc.y + 2, { width: colW });
  };
  sigBox(56, 'Issued by (for Employer)', fields.issued_by, config.company.legalName, issuerSignature, fields.date);
  sigBox(56 + colW + 24, 'Received and signed by (Employee)', signature ? signature.typed_name : (employeeName || employeeOf(app).full_name), `Employee ref: ${fields.employee_ref || app.ref}`, signature && signature.image,
    signature ? ukDate(new Date(signature.signedAt)) : '', signature ? `Signed electronically ${new Date(signature.signedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })} · IP ${signature.ip}` : null);
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor('#6b7a8c').text(`${config.company.legalName} · Company No ${config.company.regNo} · Contract of employment${contractId ? ` #${contractId}` : ''} · ${app.ref} · Page ${i + 1} of ${range.count}`,
      56, doc.page.height - 40, { width: W, align: 'center', lineBreak: false });
  }
  doc.end(); await done;
  return Buffer.concat(chunks);
}

// ---------- persistence ----------
function list(appId) {
  return db.prepare(`SELECT c.*, u.first_name || ' ' || u.last_name AS sender, v.first_name || ' ' || v.last_name AS voider FROM contracts c
    LEFT JOIN users u ON u.id = c.sent_by LEFT JOIN users v ON v.id = c.voided_by WHERE application_id = ? ORDER BY c.id DESC`).all(appId)
    .map((c) => ({ ...c, fields: decrypt(c.fields_enc), signature: c.signature_enc ? decrypt(c.signature_enc) : null }));
}

const current = (appId) => list(appId).find((c) => c.status !== 'void') || null;

function create(app, fields, user) {
  const { fields: f, body } = prepare(app, fields);
  // A new contract replaces any unsigned one still outstanding.
  db.prepare("UPDATE contracts SET status = 'void', voided_by = ?, voided_at = datetime('now'), void_reason = 'Replaced by a new contract' WHERE application_id = ? AND status = 'sent'").run(user.id, app.id);
  const sig = settings.get('contract_defaults').issuer_signature || null;
  const r = db.prepare('INSERT INTO contracts (application_id, fields_enc, body, issuer_signature, sent_by) VALUES (?, ?, ?, ?, ?)').run(app.id, encrypt(f), body, sig, user.id);
  return list(app.id).find((c) => c.id === Number(r.lastInsertRowid));
}

async function sign(app, contract, { image, typedName, ip, ua }) {
  const signature = { image, typed_name: typedName, ip, ua: String(ua || '').slice(0, 200), signedAt: new Date().toISOString() };
  const buf = await pdf({ app, body: contract.body, fields: contract.fields, issuerSignature: contract.issuer_signature, signature, contractId: contract.id });
  const name = `contract-${app.ref}-${contract.id}-${crypto.randomBytes(4).toString('hex')}.pdf.bin`;
  fs.writeFileSync(path.join(config.reportDir, name), encryptBuffer(buf));
  db.prepare("UPDATE contracts SET status = 'signed', signed_at = datetime('now'), signature_enc = ?, pdf_name = ? WHERE id = ?").run(encrypt(signature), name, contract.id);
  return buf;
}

async function pdfFor(app, contract) {
  if (contract.pdf_name) return decryptBuffer(fs.readFileSync(path.join(config.reportDir, contract.pdf_name)));
  return pdf({ app, body: contract.body, fields: contract.fields, issuerSignature: contract.issuer_signature, signature: null, contractId: contract.id });
}

const filename = (app, contract) => `Contract_${employeeOf(app).full_name.replace(/[^A-Za-z0-9]+/g, '_')}_${app.ref}${contract && contract.status === 'signed' ? '_signed' : ''}.pdf`;

module.exports = { EDITABLE, autoFields, prepare, vars, html, blocks, unresolved, pdf, pdfFor, list, current, create, sign, employeeOf, filename, ukDate };
