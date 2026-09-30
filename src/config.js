const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load .env when present (Node >= 21.7 has process.loadEnvFile).
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file */ }

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'reports'), { recursive: true });

// Encryption key for data at rest. In production this MUST be set via env and kept safe:
// losing it makes stored applications unreadable. Locally we generate one and persist it.
function loadKey() {
  if (process.env.ENCRYPTION_KEY) {
    const k = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
    if (k.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64 encoded');
    return k;
  }
  const keyFile = path.join(DATA_DIR, '.encryption-key');
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('base64'));
  return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
}

function loadSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.session-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'));
  return fs.readFileSync(f, 'utf8').trim();
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  isProd: process.env.NODE_ENV === 'production',
  baseUrl: (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''),
  dataDir: DATA_DIR,
  uploadDir: path.join(DATA_DIR, 'uploads'),
  reportDir: path.join(DATA_DIR, 'reports'),
  encryptionKey: loadKey(),
  sessionSecret: loadSessionSecret(),
  admin: {
    email: (process.env.ADMIN_EMAIL || 'admin@securityprojects.uk').toLowerCase(),
    password: process.env.ADMIN_PASSWORD || 'ChangeMe!2026',
    name: process.env.ADMIN_NAME || 'Super Admin',
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'Security Projects Recruitment <recruitment@securityprojects.uk>',
  },
  // BS 7858:2019 screening parameters
  screening: {
    periodYears: 5,
    gapDays: Number(process.env.SCREENING_GAP_DAYS || 28),
    completionWeeks: 12,
  },
  company: {
    name: 'Security Projects UK Ltd',
    legalName: 'Security Projects UK Limited',
    shortName: 'Security Projects',
    tagline: 'People & places, looked after with care.',
    address: ['Estate House, Marsh Way', 'Fairview Industrial Estate', 'Rainham, Essex', 'RM13 8UH'],
    northOffice: ['7–8 Delta Bank Road', 'Metro Riverside Park', 'Gateshead', 'NE11 9DJ'],
    phone: process.env.COMPANY_PHONE || '0303 003 2135',
    website: 'www.securityprojects.uk',
    email: process.env.COMPANY_EMAIL || 'recruitment@securityprojects.uk',
    regNo: '06808071',
    vatNo: process.env.COMPANY_VAT || '',
    since: 2009,
    accreditations: [
      { file: 'sp-sia-roac.jpg', label: 'SIA Approved Contractor' },
      { file: 'nfm-iso-9001.jpg', label: 'ISO 9001' },
      { file: 'nfm-iso-45001.jpg', label: 'ISO 45001' },
      { file: 'iso-14001.jpg', label: 'ISO 14001' },
      { file: 'iso-27001.jpg', label: 'ISO 27001' },
      { file: 'sp-act.jpg', label: 'ACT – Action Counters Terrorism' },
      { file: 'chas.jpg', label: 'CHAS' },
      { file: 'nfm-safe-contractor.jpg', label: 'SafeContractor' },
      { file: 'nfm-cop119.jpg', label: 'COP 119' },
      { file: 'nfm-ico.jpg', label: 'ICO registered' },
    ],
  },
  checkLinks: {
    sanctions: { label: 'UK Sanctions List search (FCDO)', url: 'https://search-uk-sanctions-list.service.gov.uk/' },
    sia: { label: 'SIA Register of Licence Holders', url: 'https://services.sia.homeoffice.gov.uk/rolh' },
    rtw: { label: 'View a job applicant\'s right to work (GOV.UK)', url: 'https://www.gov.uk/view-right-to-work' },
    dbs: { label: 'DBS Update Service – employer check', url: 'https://www.gov.uk/dbs-update-service' },
    basicDbs: { label: 'Request a basic DBS check', url: 'https://www.gov.uk/request-copy-criminal-record' },
    companiesHouse: { label: 'Companies House search (verify employers)', url: 'https://find-and-update.company-information.service.gov.uk/' },
  },
};
