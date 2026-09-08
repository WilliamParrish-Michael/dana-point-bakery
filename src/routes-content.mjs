/**
 * Public content: server-rendered pages (About, Process, Storage & Reheating,
 * FAQ), the "Where to Find Us" page, and JSON feeds for the homepage sections
 * (gallery + upcoming markets).
 */
import express from 'express';
import { db } from './db.mjs';
import { renderShell, renderBody, escapeHtml } from './render-page.mjs';

export const contentRouter = express.Router();

/* ── JSON feeds for the storefront homepage ───────────────────────────────── */
contentRouter.get('/api/gallery', (req, res) => {
  res.json(
    db.prepare('SELECT image_url, caption, link_url FROM gallery_posts WHERE active = 1 ORDER BY sort_order, id').all()
  );
});

contentRouter.get('/api/find-us', (req, res) => {
  res.json(upcomingEvents());
});

function upcomingEvents() {
  return db
    .prepare(
      `SELECT * FROM market_events
       WHERE active = 1 AND event_date >= date('now','localtime')
       ORDER BY event_date ASC, start_time ASC`
    )
    .all();
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

/* ── "Where to Find Us" page ──────────────────────────────────────────────── */
contentRouter.get('/find-us', (req, res) => {
  const events = upcomingEvents();
  const list = events.length
    ? `<div class="event-list">${events
        .map(
          (e) => `<article class="event">
            <div class="event-date">${escapeHtml(formatDate(e.event_date))}</div>
            <h3>${escapeHtml(e.title)}</h3>
            <div class="event-meta">
              ${e.location_name ? `<span>📍 ${escapeHtml(e.location_name)}</span>` : ''}
              ${e.start_time ? `<span>🕘 ${escapeHtml(e.start_time)}${e.end_time ? '–' + escapeHtml(e.end_time) : ''}</span>` : ''}
            </div>
            ${e.address ? `<div class="event-addr">${escapeHtml(e.address)}</div>` : ''}
            ${e.note ? `<p>${escapeHtml(e.note)}</p>` : ''}
          </article>`
        )
        .join('')}</div>`
    : '<p class="muted">No markets on the calendar right now — check back soon, or order online for Saturday pickup.</p>';

  const contentHtml = `
    <p class="eyebrow">Where to find us</p>
    <h1>Come say hello</h1>
    <p class="lede">Beyond weekly pickup, you'll find us at farmers markets and pop-ups around town. Here's where we'll be.</p>
    ${list}
    <p class="back-cta"><a class="btn-dark" href="/">Order for Saturday pickup →</a></p>`;

  res.type('html').send(renderShell({ title: 'Where to Find Us', activeHref: '/find-us', contentHtml }));
});

/* ── Editable content pages by slug (must stay last so it doesn't shadow) ──── */
contentRouter.get('/:slug', (req, res, next) => {
  const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
  if (!page) return next(); // fall through to static / 404
  const contentHtml = `
    <p class="eyebrow">${escapeHtml(page.title)}</p>
    <div class="prose">${renderBody(page.body)}</div>
    <p class="back-cta"><a class="btn-dark" href="/">Order for Saturday pickup →</a></p>`;
  res.type('html').send(renderShell({ title: page.title, activeHref: `/${page.slug}`, contentHtml }));
});
