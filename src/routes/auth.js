const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db, audit } = require('../db');
const { token } = require('../crypto');
const { PATTERNS } = require('../schema');
const apps = require('../apps');
const mailer = require('../mailer');
const config = require('../config');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).render('error', { title: 'Too many attempts', message: 'Too many attempts. Please wait 15 minutes and try again.' }) });

const passwordError = (p) => {
  if (!p || p.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain letters and numbers.';
  return null;
};

function safeNext(n) {
  return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : null;
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login', { title: 'Sign in', next: req.query.next || '', values: {}, error: null });
});

router.post('/login', limiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !u.active || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) {
    audit({ action: 'login_failed', detail: email, ip: req.ip, actor: email });
    return res.status(401).render('auth/login', { title: 'Sign in', next: req.body.next || '', values: { email }, error: 'Incorrect email or password.' });
  }
  req.session.regenerate(() => {
    req.session.userId = u.id;
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(u.id);
    audit({ user: u, action: 'login', ip: req.ip });
    const dest = safeNext(req.body.next) || (u.role === 'applicant' ? '/apply' : '/admin');
    res.redirect(dest);
  });
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/register', { title: 'Create your account', values: {}, errors: {} });
});

router.post('/register', limiter, (req, res) => {
  const v = {
    first_name: String(req.body.first_name || '').trim(),
    last_name: String(req.body.last_name || '').trim(),
    email: String(req.body.email || '').trim().toLowerCase(),
    phone: String(req.body.phone || '').trim(),
  };
  const errors = {};
  if (!v.first_name) errors.first_name = 'Enter your first name.';
  if (!v.last_name) errors.last_name = 'Enter your last name.';
  if (!PATTERNS.email.re.test(v.email)) errors.email = 'Enter a valid email address.';
  else if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(v.email)) errors.email = 'An account with this email already exists. Please sign in.';
  if (!PATTERNS.phone.re.test(v.phone)) errors.phone = 'Enter a valid mobile number.';
  const pe = passwordError(req.body.password);
  if (pe) errors.password = pe;
  else if (req.body.password !== req.body.password2) errors.password2 = 'Passwords do not match.';
  if (req.body.consent !== 'yes') errors.consent = 'Please confirm you agree to us processing your data for screening.';
  if (Object.keys(errors).length) return res.status(400).render('auth/register', { title: 'Create your account', values: v, errors });

  const r = db.prepare("INSERT INTO users (email, password_hash, role, first_name, last_name, phone) VALUES (?, ?, 'applicant', ?, ?, ?)")
    .run(v.email, bcrypt.hashSync(req.body.password, 12), v.first_name, v.last_name, v.phone);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid));
  const app = apps.createForUser(user.id);
  audit({ applicationId: app.id, user, action: 'account_created', detail: `Application ${app.ref} opened`, ip: req.ip });
  mailer.send({
    to: user.email, applicationId: app.id,
    subject: `Welcome – your onboarding reference ${app.ref}`,
    title: `Welcome, ${user.first_name}`,
    html: `<p>Thank you for starting your onboarding with ${mailer.esc(config.company.name)}. Your reference is <strong>${app.ref}</strong>.</p>
      <p>You can sign in at any time to continue your application – your progress is saved as you go.</p>
      <p><a href="${config.baseUrl}/login" style="background:#0c2547;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Continue onboarding</a></p>`,
  }).catch(() => {});
  req.session.regenerate(() => {
    req.session.userId = user.id;
    res.redirect('/apply');
  });
});

router.post('/logout', (req, res) => {
  if (req.user) audit({ user: req.user, action: 'logout', ip: req.ip });
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/forgot', (req, res) => res.render('auth/forgot', { title: 'Reset password', sent: false }));

router.post('/forgot', limiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
  if (u) {
    const t = token();
    db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(t, Date.now() + 3600000, u.id);
    await mailer.send({
      to: u.email, subject: 'Reset your password', title: 'Reset your password',
      html: `<p>We received a request to reset your password. This link is valid for 1 hour.</p>
        <p><a href="${config.baseUrl}/reset/${t}" style="background:#0c2547;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Choose a new password</a></p>
        <p>If you did not request this, you can ignore this email.</p>`,
    });
    audit({ user: u, action: 'password_reset_requested', ip: req.ip });
  }
  res.render('auth/forgot', { title: 'Reset password', sent: true });
});

router.get('/reset/:token', (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE reset_token = ? AND reset_expires > ?').get(req.params.token, Date.now());
  if (!u) return res.render('error', { title: 'Link expired', message: 'This password reset link is invalid or has expired. Please request a new one.' });
  res.render('auth/reset', { title: 'Choose a new password', error: null });
});

router.post('/reset/:token', limiter, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE reset_token = ? AND reset_expires > ?').get(req.params.token, Date.now());
  if (!u) return res.render('error', { title: 'Link expired', message: 'This password reset link is invalid or has expired.' });
  const pe = passwordError(req.body.password) || (req.body.password !== req.body.password2 ? 'Passwords do not match.' : null);
  if (pe) return res.status(400).render('auth/reset', { title: 'Choose a new password', error: pe });
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?').run(bcrypt.hashSync(req.body.password, 12), u.id);
  audit({ user: u, action: 'password_reset', ip: req.ip });
  req.flash('success', 'Your password has been changed. Please sign in.');
  res.redirect('/login');
});

module.exports = router;
module.exports.passwordError = passwordError;
