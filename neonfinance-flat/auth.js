// auth.js — JWT middleware and auth helpers
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');

const SECRET = process.env.JWT_SECRET || 'neonfinance_dev_secret_change_in_production';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function checkPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { signToken, verifyToken, hashPassword, checkPassword, requireAuth };
