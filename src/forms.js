// Sanitise submitted section data strictly against the schema.
const crypto = require('crypto');
const { visible } = require('./schema');

const MAX_TEXT = 5000;
const SIG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const rowId = () => crypto.randomBytes(6).toString('hex');

function sanitizeFields(fields, input, previous, ctx) {
  const out = {};
  input = input && typeof input === 'object' ? input : {};
  previous = previous || {};
  for (const f of fields) {
    if (['info', 'heading', 'timeline', 'files'].includes(f.type)) continue;
    const raw = input[f.key];
    switch (f.type) {
      case 'checkboxes': {
        if (f.readonly) { out[f.key] = f.default || []; break; }
        const allowed = new Set(f.options.map((o) => o.value));
        out[f.key] = (Array.isArray(raw) ? raw : []).filter((x) => allowed.has(x));
        break;
      }
      case 'radio': case 'select': case 'yesno': {
        const allowed = f.type === 'yesno' ? ['yes', 'no'] : f.options.map((o) => o.value);
        out[f.key] = allowed.includes(raw) ? raw : '';
        break;
      }
      case 'confirm':
        out[f.key] = raw === 'yes' || raw === true ? 'yes' : '';
        break;
      case 'signature': {
        const prev = previous[f.key];
        if (raw && typeof raw.image === 'string' && SIG_RE.test(raw.image) && raw.image.length < 400000) {
          out[f.key] = prev && prev.image === raw.image
            ? prev
            : { image: raw.image, signedAt: new Date().toISOString(), ip: ctx.ip, signer: ctx.signer };
        } else out[f.key] = null;
        break;
      }
      case 'repeater': {
        const rows = (Array.isArray(raw) ? raw : []).slice(0, f.max || 30);
        const prevRows = Object.fromEntries((previous[f.key] || []).filter(Boolean).map((r) => [r._id, r]));
        out[f.key] = rows.map((row) => {
          const id = row && typeof row._id === 'string' && /^[a-f0-9]{6,16}$/.test(row._id) ? row._id : rowId();
          return { _id: id, ...sanitizeFields(f.fields, row, prevRows[id], ctx) };
        });
        break;
      }
      case 'number': {
        const n = raw === '' || raw === undefined || raw === null ? '' : Number(raw);
        out[f.key] = n === '' || Number.isNaN(n) ? '' : Math.max(f.min ?? -Infinity, n);
        break;
      }
      default: {
        let s = typeof raw === 'string' ? raw.trim().slice(0, MAX_TEXT) : '';
        if (f.upper) s = s.toUpperCase();
        out[f.key] = s;
      }
    }
  }
  // Drop values of fields hidden by conditional rules.
  for (const f of fields) if (f.showIf && !visible(f, out)) delete out[f.key];
  return out;
}

// All valid upload keys for a section given its current data, e.g. "documents:sia_files", "application:history.ab12cd.evidence".
function fileKeys(section, data) {
  const keys = new Set();
  const walk = (fields, obj, prefix) => {
    for (const f of fields) {
      if (f.type === 'files') keys.add(`${section.key}:${prefix}${f.key}`);
      if (f.type === 'repeater') for (const row of (obj && obj[f.key]) || []) if (row && row._id) walk(f.fields, row, `${prefix}${f.key}.${row._id}.`);
    }
  };
  walk(section.fields, data || {}, '');
  return keys;
}

function fileKeyAllowed(section, key) {
  // Allows files in repeater rows that have not yet been saved: <rep>.<hexid>.<field>
  const rest = key.slice(section.key.length + 1);
  const parts = rest.split('.');
  if (parts.length === 1) return section.fields.some((f) => f.type === 'files' && f.key === parts[0]);
  if (parts.length === 3 && /^[a-f0-9]{6,16}$/.test(parts[1])) {
    const rep = section.fields.find((f) => f.type === 'repeater' && f.key === parts[0]);
    return !!(rep && rep.fields.some((f) => f.type === 'files' && f.key === parts[2]));
  }
  return false;
}

module.exports = { sanitizeFields, fileKeys, fileKeyAllowed };
