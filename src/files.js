const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');
const { db } = require('./db');
const { encryptBuffer, decryptBuffer } = require('./crypto');

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'application/pdf']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    const err = new Error('Only photos (JPG, PNG, HEIC, WEBP) and PDF files can be uploaded.');
    err.expose = true;
    err.status = 400;
    cb(err);
  },
});

// Check magic bytes so a renamed file can't masquerade as an image/PDF.
function sniff(buf) {
  const h = buf.subarray(0, 12);
  if (h[0] === 0xff && h[1] === 0xd8) return 'image/jpeg';
  if (h.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (h.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  if (h.subarray(0, 4).toString() === 'RIFF' && h.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (h.subarray(0, 3).toString() === 'GIF') return 'image/gif';
  if (h.subarray(4, 8).toString() === 'ftyp') return 'image/heic';
  return null;
}

function store(appId, fieldKey, file, userId) {
  const kind = sniff(file.buffer);
  if (!kind) { const e = new Error('This file type is not supported.'); e.expose = true; throw e; }
  const stored = `${crypto.randomUUID()}.bin`;
  fs.writeFileSync(path.join(config.uploadDir, stored), encryptBuffer(file.buffer));
  const name = path.basename(file.originalname).replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'upload';
  const r = db.prepare('INSERT INTO documents (application_id, field_key, original_name, stored_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(appId, fieldKey, name, stored, kind === 'image/heic' ? file.mimetype : kind, file.size, userId);
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(r.lastInsertRowid));
}

function read(doc) {
  return decryptBuffer(fs.readFileSync(path.join(config.uploadDir, doc.stored_name)));
}

function remove(doc) {
  try { fs.unlinkSync(path.join(config.uploadDir, doc.stored_name)); } catch { /* already gone */ }
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
}

function sendDoc(res, doc, download) {
  const buf = read(doc);
  res.set('Content-Type', doc.mime);
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${doc.original_name.replace(/"/g, '')}"`);
  res.send(buf);
}

module.exports = { upload, store, read, remove, sendDoc };
