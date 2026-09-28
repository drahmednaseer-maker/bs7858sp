// PDF screening file generator (pdfkit). Mirrors the company's BS 7858 screening record.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const config = require('./config');
const { db } = require('./db');
const { sections, visible, optionLabel } = require('./schema');
const { historyGaps, fmtMonth } = require('./timeline');
const { encryptBuffer, decryptBuffer, decrypt } = require('./crypto');
const apps = require('./apps');
const files = require('./files');

const LOGO = path.join(__dirname, '..', 'public', 'img', 'sp-logo.png');
const MARK = path.join(__dirname, '..', 'public', 'img', 'sp-mark.png');
const BADGES = path.join(__dirname, '..', 'public', 'img', 'accreditations');
const C = { ink: '#1b2a3a', muted: '#5b6a7c', line: '#d9e0e8', head: '#0c2547', accent: '#3d5f98', soft: '#f3f5f8', good: '#1a7f37', bad: '#c62828', warn: '#b26a00' };
const M = 48; // margin

const fmtD = (d) => {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; }
  if (/^\d{4}-\d{2}$/.test(d)) return fmtMonth(d);
  const dt = new Date(String(d).includes('T') ? d : String(d).replace(' ', 'T') + 'Z');
  return isNaN(dt) ? String(d) : dt.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
};
const fmtDate = (d) => fmtD(d).split(',')[0];

const DOC_REGISTER = [
  'Accession state worker registration card', 'Birth certificate', 'Consumer information check', 'Current passport',
  'Discharge certificate', 'Photo driving licence', 'Marriage certificate', 'Proof of address', 'SIA licence',
  'Work permit / visa', 'Sanctions list check',
];

class Report {
  constructor(opts) {
    this.opts = opts;
    this.doc = new PDFDocument({ size: 'A4', margins: { top: 70, bottom: 60, left: M, right: M }, bufferPages: true, info: { Title: opts.title, Author: config.company.name } });
    this.W = this.doc.page.width - M * 2;
    this.doc.on('pageAdded', () => this.header());
  }

  header() {
    const d = this.doc;
    const y0 = 22;
    try { d.image(LOGO, M, y0 - 6, { height: 30 }); } catch { /* logo missing */ }
    d.font('Helvetica').fontSize(8).fillColor(C.muted).text('BS 7858:2019 Security Screening File', M + 106, y0 + 6, { lineBreak: false });
    d.font('Helvetica-Bold').fontSize(8).fillColor(C.bad).text('PRIVATE & CONFIDENTIAL', M, y0, { width: this.W, align: 'right', lineBreak: false });
    d.font('Helvetica').fontSize(8).fillColor(C.muted).text(this.opts.ref, M, y0 + 12, { width: this.W, align: 'right', lineBreak: false });
    d.moveTo(M, y0 + 28).lineTo(M + this.W, y0 + 28).lineWidth(0.5).strokeColor(C.line).stroke();
    d.x = M; d.y = 70;
    d.fillColor(C.ink);
  }

  ensure(h) { if (this.doc.y + h > this.doc.page.height - 70) this.doc.addPage(); }

  h1(text) {
    this.ensure(60);
    const d = this.doc;
    d.moveDown(0.4);
    const y = d.y;
    d.rect(M, y, this.W, 24).fill(C.head);
    d.font('Helvetica-Bold').fontSize(11.5).fillColor('#fff').text(text, M + 10, y + 7, { width: this.W - 20 });
    d.y = y + 32; d.x = M; d.fillColor(C.ink);
  }

  h2(text) {
    this.ensure(40);
    const d = this.doc;
    d.moveDown(0.9);
    d.font('Helvetica-Bold').fontSize(10).fillColor(C.accent).text(text.toUpperCase(), M, d.y, { width: this.W, characterSpacing: 0.4 });
    d.moveTo(M, d.y + 2).lineTo(M + this.W, d.y + 2).lineWidth(0.5).strokeColor(C.line).stroke();
    d.y += 6; d.fillColor(C.ink);
  }

  para(text, opts = {}) {
    const d = this.doc;
    d.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 8.5).fillColor(opts.color || C.ink);
    this.ensure(d.heightOfString(text, { width: this.W }) + 4);
    d.text(text, M, d.y, { width: this.W, align: opts.align || 'left' });
    d.moveDown(0.3);
  }

  // label/value row – label column 40%
  row(label, value, opts = {}) {
    const d = this.doc;
    const lw = opts.labelWidth || this.W * 0.4;
    const vw = this.W - lw - 8;
    const val = value === undefined || value === null || value === '' ? '—' : String(value);
    d.font('Helvetica').fontSize(8.5);
    const h = Math.max(d.heightOfString(label, { width: lw - 6 }), d.heightOfString(val, { width: vw - 6 })) + 7;
    this.ensure(h);
    const y = d.y;
    if (opts.shade) d.rect(M, y, this.W, h).fill(C.soft);
    d.fillColor(C.muted).font('Helvetica').text(label, M + 4, y + 3.5, { width: lw - 6 });
    d.fillColor(opts.color || C.ink).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').text(val, M + lw + 4, y + 3.5, { width: vw - 6 });
    d.moveTo(M, y + h).lineTo(M + this.W, y + h).lineWidth(0.3).strokeColor(C.line).stroke();
    d.y = y + h; d.x = M;
  }

  table(cols, rows, opts = {}) {
    const d = this.doc;
    const total = cols.reduce((a, c) => a + c.w, 0);
    const widths = cols.map((c) => (c.w / total) * this.W);
    const drawHead = () => {
      d.font('Helvetica-Bold').fontSize(7.5);
      const hh = Math.max(...cols.map((c, i) => d.heightOfString(c.label, { width: widths[i] - 6 }))) + 8;
      this.ensure(hh + 16);
      const y = d.y;
      d.rect(M, y, this.W, hh).fill('#e7ebf1');
      let x = M;
      cols.forEach((c, i) => { d.fillColor(C.head).text(c.label, x + 3, y + 4, { width: widths[i] - 6 }); x += widths[i]; });
      d.y = y + hh;
    };
    drawHead();
    if (!rows.length) { this.row('', opts.empty || 'None recorded', { labelWidth: 4 }); return; }
    rows.forEach((r, ri) => {
      d.font('Helvetica').fontSize(7.8);
      const cells = cols.map((c) => { const v = r[c.key]; return v === undefined || v === null || v === '' ? '—' : String(v); });
      const h = Math.max(...cells.map((v, i) => d.heightOfString(v, { width: widths[i] - 6 }))) + 7;
      if (d.y + h > d.page.height - 70) { d.addPage(); drawHead(); }
      const y = d.y;
      if (ri % 2) d.rect(M, y, this.W, h).fill(C.soft);
      let x = M;
      cells.forEach((v, i) => {
        const col = cols[i];
        const color = col.tone ? ({ good: C.good, bad: C.bad, warn: C.warn }[col.tone(r)] || C.ink) : C.ink;
        d.font(col.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color).text(v, x + 3, y + 3.5, { width: widths[i] - 6 });
        x += widths[i];
      });
      d.moveTo(M, y + h).lineTo(M + this.W, y + h).lineWidth(0.3).strokeColor(C.line).stroke();
      d.y = y + h;
    });
    d.x = M;
    d.moveDown(0.5);
  }

  signature(label, sig) {
    const d = this.doc;
    this.ensure(78);
    const y = d.y;
    d.font('Helvetica').fontSize(8.5).fillColor(C.muted).text(label, M + 4, y + 4, { width: this.W * 0.4 - 6 });
    const bx = M + this.W * 0.4 + 4;
    if (sig && sig.image) {
      d.rect(bx, y + 3, 170, 56).lineWidth(0.5).strokeColor(C.line).stroke();
      try { d.image(Buffer.from(sig.image.split(',')[1], 'base64'), bx + 4, y + 5, { fit: [162, 52] }); } catch { /* bad image */ }
      d.font('Helvetica').fontSize(7).fillColor(C.muted)
        .text(`Electronically signed${sig.signer ? ` by ${sig.signer}` : ''}\n${fmtD(sig.signedAt)}${sig.ip ? `\nIP ${sig.ip}` : ''}`, bx + 180, y + 8, { width: this.W * 0.6 - 190 });
    } else {
      d.font('Helvetica').fontSize(8.5).fillColor(C.bad).text('Not signed', bx, y + 4);
    }
    d.y = y + 64; d.x = M;
    d.moveTo(M, d.y).lineTo(M + this.W, d.y).lineWidth(0.3).strokeColor(C.line).stroke();
    d.y += 2;
  }

  fieldValue(f, v) {
    if (v === undefined || v === null || v === '') return '';
    switch (f.type) {
      case 'yesno': return v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v;
      case 'confirm': return v === 'yes' ? 'Yes – confirmed' : 'Not confirmed';
      case 'radio': case 'select': return optionLabel(f, v);
      case 'checkboxes': return (v || []).map((x) => optionLabel(f, x)).join('; ') || 'None ticked';
      case 'date': case 'month': return fmtDate(v);
      default: return String(v);
    }
  }
}

function renderFields(r, fields, data, docsByKey, prefix, sectionKey, opts) {
  for (const f of fields) {
    if (f.type === 'heading') { r.h2(f.title); continue; }
    if (f.type === 'info' || f.type === 'timeline') continue;
    if (!visible(f, data)) continue;
    const v = data[f.key];
    if (f.type === 'signature') { r.signature(f.label, v); continue; }
    if (f.type === 'files') {
      const list = docsByKey[`${sectionKey}:${prefix}${f.key}`] || [];
      r.row(f.label, list.length ? list.map((x) => `${x.original_name} (uploaded ${fmtDate(x.created_at)})`).join('\n') : 'No file uploaded');
      continue;
    }
    if (f.type === 'repeater') {
      const rows = v || [];
      if (!rows.length) { r.row(f.label, 'None'); continue; }
      rows.forEach((row, i) => {
        r.ensure(30);
        r.doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.head)
          .text(`${(f.fixedLabels && f.fixedLabels[i]) || `${f.label} – entry ${i + 1}`}`, M, r.doc.y + 4);
        r.doc.moveDown(0.2);
        renderFields(r, f.fields, row, docsByKey, `${prefix}${f.key}.${row._id}.`, sectionKey, opts);
      });
      continue;
    }
    let val = r.fieldValue(f, v);
    if (opts.maskBank && sectionKey === 'bank' && f.key === 'account_number' && val) val = `****${val.slice(-4)}`;
    r.row(f.label, val);
  }
}

async function build(app, opts = {}) {
  const all = apps.data(app);
  const admin = apps.adminData(app);
  const a = all.application || {};
  const docs = apps.docs(app.id);
  const docsByKey = {};
  for (const d of docs) (docsByKey[d.field_key] = docsByKey[d.field_key] || []).push(d);
  const name = apps.applicantName(app);
  const r = new Report({ ref: app.ref, title: `Screening file ${app.ref} – ${name}` });
  const d = r.doc;
  const chunks = [];
  d.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => d.on('end', res));

  // ---------- Cover ----------
  r.header();
  try { d.image(LOGO, M + r.W / 2 - 140, 105, { width: 280 }); } catch { /* */ }
  d.y = 222;
  d.font('Helvetica-Bold').fontSize(22).fillColor(C.head).text('Security Screening File', M, d.y, { width: r.W, align: 'center' });
  d.font('Helvetica').fontSize(11).fillColor(C.muted).text('Onboarding & screening in accordance with BS 7858:2019', { width: r.W, align: 'center' });
  d.moveDown(2);
  const status = apps.STATUSES[app.status] || { label: app.status };
  const dl = apps.deadline(app);
  const gaps = historyGaps(a.history || []);
  [
    ['Applicant', name, true],
    ['Reference', app.ref],
    ['Position applied for', a.position],
    ['Current status', status.label, true],
    ['Account created', fmtD(app.created_at)],
    ['Application submitted', fmtD(app.submitted_at) || 'Not yet submitted'],
    ['Screening started', fmtD(app.screening_started_at)],
    [`Screening due (${config.screening.completionWeeks} weeks)`, dl ? `${fmtDate(dl.due.toISOString())}${['cleared', 'rejected'].includes(app.status) ? '' : ` (${dl.daysLeft >= 0 ? `${dl.daysLeft} days remaining` : `${-dl.daysLeft} days overdue`})`}` : ''],
    ['Decision date', fmtD(app.decision_at)],
    [`${config.screening.periodYears}-year history coverage`, `${gaps.coveragePct}%${gaps.gaps.length ? ` – ${gaps.gaps.length} gap(s) outstanding` : ' – continuous'}`],
    ['Report generated', `${fmtD(new Date().toISOString())} by ${opts.generatedBy || 'System'}${opts.reason ? ` (${opts.reason})` : ''}`],
  ].forEach(([l, v, b], i) => r.row(l, v, { shade: i % 2 === 0, bold: b }));
  d.moveDown(1.5);
  const badges = config.company.accreditations.slice(0, 7);
  const bw = 58; let bx = M + (r.W - badges.length * (bw + 8) + 8) / 2; const by = d.y;
  for (const b of badges) { try { d.image(path.join(BADGES, b.file), bx, by, { fit: [bw, 40], align: 'center', valign: 'center' }); } catch { /* */ } bx += bw + 8; }
  d.y = by + 52;
  r.para('This document contains personal and special-category data processed for the purpose of security screening under BS 7858:2019 and UK GDPR. It must be stored securely, access restricted to authorised personnel, and retained only for as long as required (duration of employment plus a minimum of 7 years, or 6 months for unsuccessful applicants unless otherwise required).', { size: 7.5, color: C.muted, align: 'center' });

  // ---------- Screening summary (company screening record) ----------
  d.addPage();
  r.h1('Screening record');
  const windowTo = new Date();
  const surname = a.surname || '';
  r.row('Surname', surname, { shade: true });
  r.row('First name(s)', a.forenames);
  r.row('Date of birth', fmtDate(a.dob), { shade: true });
  r.row('NI number', (all.documents || {}).ni_number);
  r.row('Screening period', `${fmtMonth(gaps.windowStart)} to ${fmtDate(windowTo.toISOString().slice(0, 10))}`, { shade: true });

  const verifs = apps.verifications(app.id);
  const vByKey = Object.fromEntries(verifs.map((v) => [v.source_key, v]));
  r.h2('Information given by the applicant & verification');
  const histRows = (a.history || []).slice().sort((x, y) => (y.from || '').localeCompare(x.from || '')).map((h) => {
    const v = vByKey[`history:${h._id}`] || {};
    const typeF = require('./schema').byKey.application.fields.find((f) => f.key === 'history').fields[0];
    return {
      from: fmtMonth(h.from), to: h.current === 'yes' ? 'Present' : fmtMonth(h.to),
      what: `${optionLabel(typeF, h.type)}${h.org_name ? ` – ${h.org_name}` : ''}${h.job_title ? `\n${h.job_title}` : ''}`,
      code: v.code || '', sent: fmtDate(v.sent_at), cfrom: v.confirmed_from ? fmtMonth(v.confirmed_from) : '', cto: v.confirmed_to ? fmtMonth(v.confirmed_to) : '',
      status: apps.VERIFICATION_STATUSES[v.status] || 'Not sent', _s: v.status,
    };
  });
  const tone = (row) => (row._s === 'verified' ? 'good' : row._s === 'unable' ? 'bad' : 'warn');
  r.table([
    { key: 'from', label: 'From', w: 9 }, { key: 'to', label: 'To', w: 9 }, { key: 'what', label: 'Employer / history', w: 30 },
    { key: 'code', label: 'Code', w: 6 }, { key: 'sent', label: 'Request sent', w: 11 }, { key: 'cfrom', label: 'Confirmed from', w: 10 },
    { key: 'cto', label: 'Confirmed to', w: 10 }, { key: 'status', label: 'Status', w: 13, tone },
  ], histRows);
  if (gaps.gaps.length) r.para(`Gaps: ${gaps.gaps.map((g) => `${fmtMonth(g.from)}–${fmtMonth(g.to)}`).join(', ')}`, { color: C.bad, bold: true });
  r.row(`${config.screening.periodYears}-year screening completed`, admin.screening_completed ? fmtDate(admin.screening_completed) : 'Not yet completed', { bold: true });

  r.h2('References');
  r.table([
    { key: 'name', label: 'Name', w: 26 }, { key: 'sent', label: 'Request sent', w: 13 }, { key: 'code', label: 'Code', w: 7 },
    { key: 'reply', label: 'Reply received', w: 13 }, { key: 'status', label: 'Status', w: 14, tone }, { key: 'notes', label: 'Comments', w: 27 },
  ], verifs.filter((v) => v.kind === 'reference').map((v) => ({ name: v.label.replace(/^Reference \d+ – /, ''), sent: fmtDate(v.sent_at), code: v.code, reply: fmtDate(v.responded_at), status: apps.VERIFICATION_STATUSES[v.status], _s: v.status, notes: v.notes })));

  r.h2('Documents register');
  const reg = admin.documents_register || {};
  r.table([
    { key: 'doc', label: 'Document', w: 34 }, { key: 'seen', label: 'Copy / Original / N/A', w: 18 }, { key: 'comments', label: 'Comments', w: 48 },
  ], DOC_REGISTER.map((x) => ({ doc: x, seen: ({ copy: 'Copy', original: 'Original', na: 'N/A' })[(reg[x] || {}).seen] || '', comments: (reg[x] || {}).comments })));

  r.h2('Screening checks');
  const checkTone = (row) => ({ pass: 'good', fail: 'bad', refer: 'warn', pending: 'warn' }[row._s]);
  r.table([
    { key: 'label', label: 'Check', w: 24 }, { key: 'result', label: 'Result', w: 11, tone: checkTone, bold: true }, { key: 'ref', label: 'Reference', w: 17 },
    { key: 'notes', label: 'Notes', w: 26 }, { key: 'by', label: 'Checked by / date', w: 22 },
  ], apps.checks(app.id).map((c) => ({
    label: c.label, result: ({ pass: 'Pass', fail: 'Fail', refer: 'Refer', na: 'N/A', pending: 'Pending' })[c.status], _s: c.status,
    ref: c.reference, notes: c.notes, by: c.checker ? `${c.checker}\n${fmtD(c.checked_at)}` : '',
  })));

  r.h2('Check evidence');
  const evRows = [];
  for (const c of apps.checks(app.id)) for (const e of c.evidence) evRows.push({ check: c.label, file: e.original_name, by: e.uploader || '', at: fmtD(e.created_at) });
  r.table([
    { key: 'check', label: 'Check', w: 24 }, { key: 'file', label: 'Evidence file (image in appendix)', w: 40 }, { key: 'by', label: 'Attached by', w: 18 }, { key: 'at', label: 'Date / time', w: 18 },
  ], evRows, { empty: 'No evidence attached to checks yet' });

  r.h2('Authorisation');
  const auth = admin.authorisation || {};
  const authRow = (k, label) => {
    const x = auth[k];
    if (!x) { r.row(label, 'Not given'); return; }
    r.row(`${label} – authorised by`, `${x.by} on ${fmtD(x.at)}`, { bold: true });
    if (x.start_date) r.row('Employment start date', fmtDate(x.start_date));
    if (x.notes) r.row('Notes', x.notes);
    if (x.signature) r.signature(`${label} – signature`, x.signature);
  };
  authRow('conditional', 'Conditional (provisional) employment');
  authRow('confirmed', 'Confirmed (full screening complete)');
  if (auth.declined) authRow('declined', 'Declined');

  r.h2('Codes');
  r.para(Object.entries(apps.LETTER_CODES).map(([k, v]) => `${k} – ${v}`).join('    '), { size: 7.5, color: C.muted });
  r.h2('Official checks – services used');
  Object.values(config.checkLinks).forEach((l) => r.row(l.label, l.url));

  // ---------- Sections ----------
  for (const s of sections) {
    if (s.key === 'diversity' && !opts.includeDiversity) continue;
    d.addPage();
    r.h1(`Section ${s.num} – ${s.title}`);
    const sd = all[s.key];
    if (!sd) { r.para('Not completed.', { color: C.bad }); continue; }
    renderFields(r, s.fields, sd, docsByKey, '', s.key, { maskBank: !opts.fullBank });
    if (s.key === 'health') {
      r.h2("Employer's comments");
      r.row('Comments and actions', (admin.health || {}).comments);
      if ((admin.health || {}).signature) r.signature("Employer's signature", admin.health.signature);
    }
    if (s.key === 'optout' && (admin.optout || {}).signature) {
      r.h2('For and on behalf of the Employer');
      r.signature('Employer signature', admin.optout.signature);
    }
    if (s.key === 'bank') {
      r.h2('Seen / copied / checked');
      const b = admin.bank || {};
      r.row('Checked by', b.by ? `${b.by} on ${fmtD(b.at)}` : 'Not yet checked');
    }
  }

  // ---------- Referee responses ----------
  const responded = verifs.filter((v) => v.response_enc);
  if (responded.length) {
    d.addPage();
    r.h1('Verification & reference responses');
    for (const v of responded) {
      r.h2(v.label);
      const resp = decrypt(v.response_enc);
      for (const [k, val] of Object.entries(resp)) if (k !== 'signature') r.row(k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), val);
      r.row('Received', fmtD(v.responded_at));
    }
  }

  // ---------- Document images ----------
  const images = docs.filter((x) => ['image/jpeg', 'image/png'].includes(x.mime));
  if (images.length && opts.includeImages !== false) {
    d.addPage();
    r.h1('Appendix – document images');
    for (const img of images) {
      r.ensure(300);
      const chk = img.field_key.startsWith('admin:check_') && apps.CHECK_TYPES.find((c) => `admin:check_${c.type}` === img.field_key);
      const by = img.uploaded_by ? db.prepare("SELECT first_name || ' ' || last_name AS n FROM users WHERE id = ?").get(img.uploaded_by) : null;
      const where = chk ? `Check evidence: ${chk.label}` : img.field_key.replace(/^[^:]+:/, '').replace(/\.[a-f0-9]{12}\./, ' › ');
      r.doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.head).text(`${img.original_name}  ·  ${where}  ·  ${chk && by ? `attached by ${by.n}` : 'uploaded'} ${fmtD(img.created_at)}`, M, d.y);
      try {
        d.image(files.read(img), M, d.y + 4, { fit: [r.W, 270], align: 'center' });
      } catch { r.para('(image could not be embedded)', { color: C.muted }); }
      d.y += 284;
    }
    const other = docs.filter((x) => !['image/jpeg', 'image/png'].includes(x.mime));
    if (other.length) {
      r.h2('Other attachments (view in portal)');
      other.forEach((x) => r.row(x.original_name, `${x.field_key} · ${x.mime} · ${fmtD(x.created_at)}`));
    }
  }

  // ---------- Audit trail ----------
  d.addPage();
  r.h1('Audit trail');
  const log = db.prepare('SELECT * FROM audit_log WHERE application_id = ? ORDER BY id').all(app.id);
  r.table([{ key: 'at', label: 'Date / time', w: 18 }, { key: 'actor', label: 'User', w: 20 }, { key: 'action', label: 'Action', w: 22 }, { key: 'detail', label: 'Detail', w: 28 }, { key: 'ip', label: 'IP', w: 12 }],
    log.map((l) => ({ at: fmtD(l.created_at), actor: l.actor, action: l.action.replace(/_/g, ' '), detail: l.detail, ip: l.ip })));

  // Footer with page numbers
  const range = d.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    d.switchToPage(i);
    const y = d.page.height - 40;
    d.page.margins.bottom = 0;
    d.font('Helvetica').fontSize(7).fillColor(C.muted)
      .text(`${config.company.legalName} · Company No ${config.company.regNo} · ${config.company.website} · ${app.ref} · Page ${i + 1} of ${range.count}`, M, y, { width: r.W, align: 'center', lineBreak: false });
  }
  d.end();
  await done;
  return Buffer.concat(chunks);
}

async function snapshot(app, user, reason) {
  const buf = await build(app, { generatedBy: user ? `${user.first_name} ${user.last_name}` : 'System', reason });
  const name = `${app.ref}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pdf.bin`;
  fs.writeFileSync(path.join(config.reportDir, name), encryptBuffer(buf));
  db.prepare('INSERT INTO reports (application_id, stored_name, reason, created_by) VALUES (?, ?, ?, ?)').run(app.id, name, reason, user ? user.id : null);
  return name;
}

function readSnapshot(row) {
  return decryptBuffer(fs.readFileSync(path.join(config.reportDir, row.stored_name)));
}

module.exports = { build, snapshot, readSnapshot, DOC_REGISTER };
