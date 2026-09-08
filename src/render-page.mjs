/**
 * Server-side renderer for the content pages (About, Process, Storage &
 * Reheating, FAQ) and the "Where to Find Us" page. Produces a full HTML
 * document that shares the storefront's header, nav, footer, and styles.css.
 */
import { db, getSetting } from './db.mjs';

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** Nav items, shared by server-rendered pages and the storefront (via /api/shop). */
export function navItems() {
  const pages = db
    .prepare('SELECT slug, title FROM pages WHERE in_nav = 1 ORDER BY sort_order, id')
    .all();
  return [
    { label: 'Order', href: '/' },
    { label: 'Where to Find Us', href: '/find-us' },
    ...pages.map((p) => ({ label: p.title, href: `/${p.slug}` })),
  ];
}

/** Convert the simple page body (blank-line paragraphs, '## ' subheadings) to HTML. */
export function renderBody(body) {
  return String(body || '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) =>
      block.startsWith('## ')
        ? `<h2>${escapeHtml(block.slice(3).trim())}</h2>`
        : `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`
    )
    .join('\n');
}

function navHtml(activeHref) {
  const items = navItems()
    .map(
      (i) =>
        `<a href="${escapeHtml(i.href)}"${i.href === activeHref ? ' class="active"' : ''}>${escapeHtml(i.label)}</a>`
    )
    .join('');
  return `<nav class="main-nav">${items}</nav>`;
}

function footerHtml() {
  const shop = getSetting('shop_name');
  const ig = getSetting('instagram_url');
  const fb = getSetting('facebook_url');
  const email = getSetting('contact_email');
  const window = getSetting('pickup_window');
  const socials = [
    ig ? `<a href="${escapeHtml(ig)}" rel="noopener" target="_blank">Instagram</a>` : '',
    fb ? `<a href="${escapeHtml(fb)}" rel="noopener" target="_blank">Facebook</a>` : '',
    email ? `<a href="mailto:${escapeHtml(email)}">Email</a>` : '',
  ]
    .filter(Boolean)
    .join('');
  return `<footer><div class="wrap">
    <div>${escapeHtml(shop)} · Baked fresh in Dana Point, CA · ${escapeHtml(window)}</div>
    ${socials ? `<div class="foot-social">${socials}</div>` : ''}
  </div></footer>`;
}

/**
 * Full HTML document for a content page.
 * @param {{ title:string, activeHref:string, contentHtml:string }} opts
 */
export function renderShell({ title, activeHref, contentHtml }) {
  const shop = getSetting('shop_name');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — ${escapeHtml(shop)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="site-head">
    <div class="wrap">
      <a class="brand" href="/"><span class="loaf">🍞</span><span>${escapeHtml(shop)}</span></a>
      <input type="checkbox" id="nav-toggle" class="nav-toggle" hidden />
      ${navHtml(activeHref)}
      <div class="head-actions">
        <a class="cart-btn" href="/">Order</a>
        <label for="nav-toggle" class="nav-burger" aria-label="Open menu"></label>
      </div>
    </div>
  </header>
  <main class="content-page">
    <div class="wrap">
      ${contentHtml}
    </div>
  </main>
  ${footerHtml()}
</body>
</html>`;
}
