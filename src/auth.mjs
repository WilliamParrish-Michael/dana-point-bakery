/**
 * Baker admin auth: a single password (from ADMIN_PASSWORD) exchanged for a
 * signed, HttpOnly session cookie. No user table — one baker, one password.
 */
import crypto from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || 'insecure-dev-secret-change-me';
const COOKIE = 'bakery_admin';
const TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [data, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Constant-time password check against ADMIN_PASSWORD. */
export function checkPassword(input) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false;
  const a = Buffer.from(String(input));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function issueSession(res) {
  const token = sign({ role: 'baker', exp: Date.now() + TTL_MS });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TTL_MS,
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

/** Express middleware — 401 unless a valid admin cookie is present. */
export function requireAdmin(req, res, next) {
  const payload = verify(req.cookies?.[COOKIE]);
  if (!payload || payload.role !== 'baker') {
    return res.status(401).json({ error: 'Not signed in.' });
  }
  next();
}

export function isAdmin(req) {
  const payload = verify(req.cookies?.[COOKIE]);
  return Boolean(payload && payload.role === 'baker');
}
