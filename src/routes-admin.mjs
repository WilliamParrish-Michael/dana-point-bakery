/**
 * Baker admin API: login, breads, weekly batches, orders, settings.
 * Everything except login/session is behind requireAdmin.
 */
import express from 'express';
import { db, getSetting, setSetting } from './db.mjs';
import { checkPassword, issueSession, clearSession, requireAdmin, isAdmin } from './auth.mjs';
import { uploadImage } from './uploads.mjs';

export const adminRouter = express.Router();

/* ── auth ─────────────────────────────────────────────────────────────────── */
adminRouter.post('/api/admin/login', (req, res) => {
  if (!checkPassword(req.body?.password)) return res.status(401).json({ error: 'Wrong password.' });
  issueSession(res);
  res.json({ ok: true });
});
adminRouter.post('/api/admin/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});
adminRouter.get('/api/admin/session', (req, res) => res.json({ signedIn: isAdmin(req) }));

// Everything under /api/admin below this line requires a signed-in baker.
// Scope the guard to /api/admin so it never intercepts the storefront or static files.
adminRouter.use('/api/admin', requireAdmin);

/* ── photo upload ─────────────────────────────────────────────────────────── */
adminRouter.post('/api/admin/upload', (req, res) => {
  uploadImage(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image received.' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

/* ── breads ───────────────────────────────────────────────────────────────── */
adminRouter.get('/api/admin/breads', (req, res) => {
  res.json(db.prepare('SELECT * FROM breads ORDER BY sort_order, id').all());
});
adminRouter.post('/api/admin/breads', (req, res) => {
  const { name, description = '', price_cents = 0, photo_url = '', active = 1, sort_order = 0 } =
    req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  const info = db
    .prepare(
      `INSERT INTO breads (name, description, price_cents, photo_url, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(name.trim(), description, Math.max(0, Math.round(price_cents)), photo_url, active ? 1 : 0, sort_order);
  res.json({ id: Number(info.lastInsertRowid) });
});
adminRouter.put('/api/admin/breads/:id', (req, res) => {
  const { name, description, price_cents, photo_url, active, sort_order } = req.body || {};
  db.prepare(
    `UPDATE breads SET name=?, description=?, price_cents=?, photo_url=?, active=?, sort_order=?
     WHERE id=?`
  ).run(
    name?.trim() || '',
    description || '',
    Math.max(0, Math.round(price_cents || 0)),
    photo_url || '',
    active ? 1 : 0,
    sort_order || 0,
    req.params.id
  );
  res.json({ ok: true });
});
adminRouter.delete('/api/admin/breads/:id', (req, res) => {
  // Soft-delete (deactivate) so past orders keep their reference.
  db.prepare('UPDATE breads SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ── pickups + weekly batch ───────────────────────────────────────────────── */
adminRouter.get('/api/admin/pickups', (req, res) => {
  res.json(db.prepare('SELECT * FROM pickups ORDER BY pickup_date DESC').all());
});
adminRouter.post('/api/admin/pickups', (req, res) => {
  const date = String(req.body?.pickup_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'Pickup date must be YYYY-MM-DD.' });
  db.prepare(
    `INSERT INTO pickups (pickup_date, is_open, note) VALUES (?, 1, ?)
     ON CONFLICT(pickup_date) DO UPDATE SET note = excluded.note`
  ).run(date, req.body?.note || '');
  res.json({ ok: true });
});
adminRouter.patch('/api/admin/pickups/:id', (req, res) => {
  const { is_open, note } = req.body || {};
  if (is_open !== undefined)
    db.prepare('UPDATE pickups SET is_open = ? WHERE id = ?').run(is_open ? 1 : 0, req.params.id);
  if (note !== undefined)
    db.prepare('UPDATE pickups SET note = ? WHERE id = ?').run(note, req.params.id);
  res.json({ ok: true });
});

/** Batch quantities for a pickup: current totals + how many are spoken for. */
adminRouter.get('/api/admin/batch/:pickupId', (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.id AS bread_id, b.name, b.price_cents,
              COALESCE(bi.quantity_total, 0)    AS quantity_total,
              COALESCE(bi.quantity_reserved, 0) AS quantity_reserved
       FROM breads b
       LEFT JOIN batch_items bi ON bi.bread_id = b.id AND bi.pickup_id = ?
       WHERE b.active = 1
       ORDER BY b.sort_order, b.id`
    )
    .all(req.params.pickupId);
  res.json(rows);
});
/** Set how many of a bread are baked for this pickup. Can't go below reserved. */
adminRouter.post('/api/admin/batch/:pickupId', (req, res) => {
  const { bread_id, quantity_total } = req.body || {};
  const qty = Math.max(0, Math.round(Number(quantity_total)));
  const existing = db
    .prepare('SELECT quantity_reserved FROM batch_items WHERE pickup_id = ? AND bread_id = ?')
    .get(req.params.pickupId, bread_id);
  if (existing && qty < existing.quantity_reserved)
    return res.status(409).json({
      error: `${existing.quantity_reserved} already ordered — can't set below that.`,
    });
  db.prepare(
    `INSERT INTO batch_items (pickup_id, bread_id, quantity_total, quantity_reserved)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(pickup_id, bread_id) DO UPDATE SET quantity_total = excluded.quantity_total`
  ).run(req.params.pickupId, bread_id, qty);
  res.json({ ok: true });
});

/* ── orders ───────────────────────────────────────────────────────────────── */
adminRouter.get('/api/admin/orders', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.pickupId) {
    where.push('o.pickup_id = ?');
    params.push(req.query.pickupId);
  }
  if (req.query.status) {
    where.push('o.status = ?');
    params.push(req.query.status);
  }
  const orders = db
    .prepare(
      `SELECT o.*, p.pickup_date FROM orders o JOIN pickups p ON p.id = o.pickup_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY o.created_at DESC`
    )
    .all(...params);
  const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  for (const o of orders) o.items = itemStmt.all(o.id);
  res.json(orders);
});
adminRouter.patch('/api/admin/orders/:id', (req, res) => {
  const status = String(req.body?.status || '');
  if (!['paid', 'picked_up', 'cancelled'].includes(status))
    return res.status(400).json({ error: 'Invalid status.' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

/* ── settings ─────────────────────────────────────────────────────────────── */
const SETTING_KEYS = [
  'shop_name',
  'tagline',
  'pickup_location',
  'pickup_window',
  'order_instructions',
];
adminRouter.get('/api/admin/settings', (req, res) => {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k);
  res.json(out);
});
adminRouter.put('/api/admin/settings', (req, res) => {
  for (const k of SETTING_KEYS) if (req.body?.[k] !== undefined) setSetting(k, req.body[k]);
  res.json({ ok: true });
});
