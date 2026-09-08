/**
 * Baker admin for Phase 2 content: editable pages, "Where to Find Us" markets,
 * and the photo gallery. Mounted alongside the main admin router; guarded by the
 * same requireAdmin gate.
 */
import express from 'express';
import { db } from './db.mjs';
import { requireAdmin } from './auth.mjs';

export const adminContentRouter = express.Router();
adminContentRouter.use('/api/admin', requireAdmin);

/* ── pages ────────────────────────────────────────────────────────────────── */
adminContentRouter.get('/api/admin/pages', (req, res) => {
  res.json(db.prepare('SELECT * FROM pages ORDER BY sort_order, id').all());
});
adminContentRouter.put('/api/admin/pages/:slug', (req, res) => {
  const { title, body, in_nav } = req.body || {};
  const info = db
    .prepare(
      `UPDATE pages SET title = ?, body = ?, in_nav = ?, updated_at = datetime('now')
       WHERE slug = ?`
    )
    .run(title ?? '', body ?? '', in_nav ? 1 : 0, req.params.slug);
  if (info.changes === 0) return res.status(404).json({ error: 'Page not found.' });
  res.json({ ok: true });
});

/* ── market events ("Where to Find Us") ───────────────────────────────────── */
adminContentRouter.get('/api/admin/events', (req, res) => {
  res.json(db.prepare('SELECT * FROM market_events ORDER BY event_date DESC, id DESC').all());
});
adminContentRouter.post('/api/admin/events', (req, res) => {
  const e = req.body || {};
  if (!e.title?.trim()) return res.status(400).json({ error: 'Title is required.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.event_date || ''))
    return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required.' });
  const info = db
    .prepare(
      `INSERT INTO market_events (title, location_name, address, event_date, start_time, end_time, note, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(e.title.trim(), e.location_name || '', e.address || '', e.event_date,
      e.start_time || '', e.end_time || '', e.note || '');
  res.json({ id: Number(info.lastInsertRowid) });
});
adminContentRouter.put('/api/admin/events/:id', (req, res) => {
  const e = req.body || {};
  db.prepare(
    `UPDATE market_events SET title=?, location_name=?, address=?, event_date=?,
       start_time=?, end_time=?, note=?, active=? WHERE id=?`
  ).run(e.title || '', e.location_name || '', e.address || '', e.event_date || '',
    e.start_time || '', e.end_time || '', e.note || '', e.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
adminContentRouter.delete('/api/admin/events/:id', (req, res) => {
  db.prepare('DELETE FROM market_events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ── gallery ──────────────────────────────────────────────────────────────── */
adminContentRouter.get('/api/admin/gallery', (req, res) => {
  res.json(db.prepare('SELECT * FROM gallery_posts ORDER BY sort_order, id').all());
});
adminContentRouter.post('/api/admin/gallery', (req, res) => {
  const g = req.body || {};
  if (!g.image_url?.trim()) return res.status(400).json({ error: 'An image is required.' });
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM gallery_posts').get().m;
  const info = db
    .prepare('INSERT INTO gallery_posts (image_url, caption, link_url, sort_order) VALUES (?, ?, ?, ?)')
    .run(g.image_url.trim(), g.caption || '', g.link_url || '', maxSort + 1);
  res.json({ id: Number(info.lastInsertRowid) });
});
adminContentRouter.put('/api/admin/gallery/:id', (req, res) => {
  const g = req.body || {};
  db.prepare('UPDATE gallery_posts SET caption=?, link_url=?, active=? WHERE id=?')
    .run(g.caption || '', g.link_url || '', g.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
adminContentRouter.delete('/api/admin/gallery/:id', (req, res) => {
  db.prepare('DELETE FROM gallery_posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
