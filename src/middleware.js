const crypto = require('crypto');
const { db } = require('./db');

function loadUser(req, res, next) {
  res.locals.user = null;
  if (req.session.userId) {
    const u = db.prepare('SELECT id, email, role, first_name, last_name, phone, active FROM users WHERE id = ?').get(req.session.userId);
    if (u && u.active) { req.user = u; res.locals.user = u; } else { req.session.userId = null; }
  }
  next();
}

// Synchroniser-token CSRF protection. Token is available to views as `csrf`
// and accepted from a form field (_csrf) or the X-CSRF-Token header.
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Multipart forms are parsed after this middleware, so they pass the token in the query string.
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || (typeof req.query._csrf === 'string' ? req.query._csrf : null);
  if (sent && sent.length === req.session.csrf.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.session.csrf))) return next();
  res.status(403);
  if (req.xhr || (req.get('accept') || '').includes('json')) return res.json({ error: 'Your session has expired. Please refresh the page.' });
  return res.render('error', { title: 'Session expired', message: 'Your form session has expired. Please go back, refresh the page and try again.' });
}

function flash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, msg) => { req.session.flash = { type, msg }; };
  next();
}

const requireLogin = (req, res, next) => (req.user ? next() : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`));
const requireStaff = (req, res, next) => {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  if (!['reviewer', 'superadmin'].includes(req.user.role)) return res.status(403).render('error', { title: 'Access denied', message: 'You do not have permission to view this page.' });
  next();
};
const requireSuper = (req, res, next) => (req.user && req.user.role === 'superadmin' ? next() : res.status(403).render('error', { title: 'Access denied', message: 'Super admin access is required.' }));
const requireApplicant = (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'applicant') return res.redirect('/admin');
  next();
};

module.exports = { loadUser, csrf, flash, requireLogin, requireStaff, requireSuper, requireApplicant };
