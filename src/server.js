const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const config = require('./config');
require('./db');
const SqliteStore = require('./sessionStore');
const { loadUser, csrf, flash } = require('./middleware');
const { STATUSES } = require('./apps');
const { smtpConfigured } = require('./mailer');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');
Object.assign(app.locals, { visible: require('./schema').visible, optionLabel: require('./schema').optionLabel, countryName: require('./countries').countryName });

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'"],
      frameSrc: ["'self'"],
      objectSrc: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: config.isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use((req, res, next) => {
  Object.assign(res.locals, { user: null, csrf: '', flash: null, title: '' });
  res.locals.company = config.company;
  res.locals.STATUSES = STATUSES;
  res.locals.path = req.path;
  res.locals.smtpConfigured = smtpConfigured;
  res.locals.baseUrl = config.baseUrl;
  res.locals.fmtDate = (d) => {
    if (!d) return '';
    const dt = typeof d === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:/.test(d) ? new Date(d.replace(' ', 'T') + 'Z') : new Date(d);
    return isNaN(dt) ? d : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  res.locals.fmtDateTime = (d) => {
    if (!d) return '';
    const dt = new Date(String(d).replace(' ', 'T') + (String(d).includes('Z') ? '' : 'Z'));
    return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  };
  next();
});

app.use('/', express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '7d' : 0 }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(express.json({ limit: '8mb' })); // signatures are sent as PNG data URLs

app.use(session({
  store: new SqliteStore(),
  name: 'sp.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 1000 * 60 * 60 * 8 },
}));

app.use(loadUser);
app.use(flash);

// Referee pages (/r/:token) are public but still post the CSRF token from the session they open.
app.use(csrf);

app.use(require('./routes/auth'));
app.use('/r', require('./routes/referee'));
app.use('/apply', require('./routes/applicant'));
app.use('/admin', require('./routes/admin'));

app.get('/', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'applicant' ? '/apply' : '/admin');
  res.render('home', { title: 'Onboarding & Security Screening' });
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).render('error', { title: 'Page not found', message: 'The page you were looking for does not exist.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large (maximum 15 MB).' });
  if (req.xhr || (req.get('accept') || '').includes('json')) return res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong. Please try again.' });
  res.status(500).render('error', { title: 'Something went wrong', message: 'An unexpected error occurred. Please try again.' });
});

app.listen(config.port, () => {
  console.log(`\n  ${config.company.name} – BS 7858 Onboarding`);
  console.log(`  Running at ${config.baseUrl}`);
  console.log(`  Data directory: ${config.dataDir}`);
  console.log(`  Email: ${smtpConfigured ? 'SMTP configured' : 'SMTP not configured – emails are stored in the admin Outbox'}\n`);
});
