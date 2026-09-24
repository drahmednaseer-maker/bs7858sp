const crypto = require('crypto');
const { encryptionKey } = require('./config');

// AES-256-GCM. Output: base64(iv[12] | tag[16] | ciphertext)
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function decrypt(str) {
  if (!str) return {};
  const buf = Buffer.from(str, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const pt = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

// Files on disk are encrypted with the same scheme (raw buffers).
function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function decryptBuffer(buf) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

const token = (n = 32) => crypto.randomBytes(n).toString('hex');

module.exports = { encrypt, decrypt, encryptBuffer, decryptBuffer, token };
