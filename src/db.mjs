/**
 * SQLite database: schema, initialization, and settings helpers.
 *
 * One file, zero external services. The whole shop lives in data/bakery.db so the
 * site is trivial to back up (copy the file) and hand over (copy the folder).
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, 'bakery.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS breads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    price_cents  INTEGER NOT NULL DEFAULT 0,
    photo_url    TEXT    NOT NULL DEFAULT '',
    active       INTEGER NOT NULL DEFAULT 1,
    sort_order   INTEGER NOT NULL DEFAULT 0
  );

  -- One row per Saturday pickup. quantity per bread lives in batch_items.
  CREATE TABLE IF NOT EXISTS pickups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    pickup_date  TEXT    NOT NULL UNIQUE,        -- 'YYYY-MM-DD'
    is_open      INTEGER NOT NULL DEFAULT 1,     -- baker can pause ordering
    note         TEXT    NOT NULL DEFAULT ''
  );

  -- The weekly batch: how many of each bread are available for a given pickup.
  -- quantity_reserved counts loaves held by pending + paid orders.
  CREATE TABLE IF NOT EXISTS batch_items (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    pickup_id          INTEGER NOT NULL REFERENCES pickups(id) ON DELETE CASCADE,
    bread_id           INTEGER NOT NULL REFERENCES breads(id)  ON DELETE CASCADE,
    quantity_total     INTEGER NOT NULL DEFAULT 0,
    quantity_reserved  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (pickup_id, bread_id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    pickup_id        INTEGER NOT NULL REFERENCES pickups(id),
    customer_name    TEXT    NOT NULL DEFAULT '',
    customer_email   TEXT    NOT NULL DEFAULT '',
    customer_phone   TEXT    NOT NULL DEFAULT '',
    note             TEXT    NOT NULL DEFAULT '',
    status           TEXT    NOT NULL DEFAULT 'pending',  -- pending|paid|cancelled|picked_up
    total_cents      INTEGER NOT NULL DEFAULT 0,
    paypal_order_id  TEXT    NOT NULL DEFAULT '',
    paypal_capture_id TEXT   NOT NULL DEFAULT '',
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    paid_at          TEXT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    bread_id         INTEGER NOT NULL REFERENCES breads(id),
    name_snapshot    TEXT    NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    quantity         INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_pickup ON orders(pickup_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_batch_pickup  ON batch_items(pickup_id);

  CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  -- Editable content pages (About, Our Process, Storage & Reheating, FAQ).
  CREATE TABLE IF NOT EXISTS pages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL UNIQUE,           -- 'about', 'process', 'storage-reheating', 'faq'
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',       -- blank-line paragraphs; lines starting '## ' are subheadings
    in_nav      INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- "Where to find us" — farmers markets / pop-up appearances.
  CREATE TABLE IF NOT EXISTS market_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    location_name  TEXT NOT NULL DEFAULT '',
    address        TEXT NOT NULL DEFAULT '',
    event_date     TEXT NOT NULL,               -- 'YYYY-MM-DD'
    start_time     TEXT NOT NULL DEFAULT '',
    end_time       TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    active         INTEGER NOT NULL DEFAULT 1
  );

  -- Baker-controlled photo gallery (an Instagram-style strip they own).
  CREATE TABLE IF NOT EXISTS gallery_posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url   TEXT NOT NULL,
    caption     TEXT NOT NULL DEFAULT '',
    link_url    TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1
  );
`);

/* ── settings helpers ─────────────────────────────────────────────────────── */

const _getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const _setSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

export function getSetting(key, fallback = '') {
  const row = _getSetting.get(key);
  return row ? row.value : fallback;
}
export function setSetting(key, value) {
  _setSetting.run(key, String(value));
}

/** Fill in defaults once so the admin has something to edit. */
const DEFAULT_SETTINGS = {
  shop_name: 'Dana Point Bread',
  tagline: 'Fresh-baked, small-batch. Order by Thursday — pick up Saturday.',
  pickup_location: 'Dana Point, CA (address shared after you order)',
  pickup_window: 'Saturdays, 9:00 AM – 12:00 PM',
  order_instructions: 'Bring your name; we\'ll have your bread bagged and ready.',
  hero_line: 'Good bread takes time.',
  instagram_url: '',
  facebook_url: '',
  contact_email: '',
  gallery_heading: 'Fresh from the oven',
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  if (!_getSetting.get(k)) _setSetting.run(k, v);
}

/** Seed a few example breads on first run so the store isn't empty. */
export function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM breads').get().n;
  if (count > 0) return;
  const insert = db.prepare(
    'INSERT INTO breads (name, description, price_cents, photo_url, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  const samples = [
    ['Classic Sourdough', 'Naturally leavened over a 24-hour ferment. Crackly, blistered crust and a tender, open crumb — our everyday loaf.', 900, '/uploads/seed-sourdough.jpg', 1],
    ['Country Whole Wheat', 'Stone-milled whole wheat with a touch of rye. Hearty, mildly nutty, and great for sandwiches or toast.', 900, '/uploads/seed-wholewheat.jpg', 2],
    ['Rustic Baguette', 'Crisp, shatter-crust exterior and a light, airy interior. Sold as a pair — one to eat on the way home.', 700, '/uploads/seed-baguette.jpg', 3],
    ['Cinnamon Raisin', 'Soft sourdough swirled with Saigon cinnamon and plump, wine-soaked raisins. Unbeatable toasted with butter.', 1000, '/uploads/seed-cinnamon.jpg', 4],
    ['Jalapeño Cheddar', 'Loaded with sharp aged cheddar and fresh jalapeño. A little heat, a lot of melt — a weekend favorite.', 1100, '/uploads/seed-jalapeno.jpg', 5],
  ];
  const tx = db.transaction(() => samples.forEach((s) => insert.run(...s)));
  tx();
}

/**
 * On a brand-new database, also create a demo pickup for the upcoming Saturday
 * with a batch of each bread — so a fresh deploy shows a populated storefront
 * right away. The baker can edit or delete it from the admin.
 */
export function seedDemoPickupIfEmpty() {
  const hasPickup = db.prepare('SELECT COUNT(*) AS n FROM pickups').get().n;
  if (hasPickup > 0) return;

  const now = new Date();
  const daysUntilSat = (6 - now.getDay() + 7) % 7; // 0 if today is Saturday
  const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSat);
  const iso = `${sat.getFullYear()}-${String(sat.getMonth() + 1).padStart(2, '0')}-${String(sat.getDate()).padStart(2, '0')}`;

  const tx = db.transaction(() => {
    const res = db
      .prepare('INSERT INTO pickups (pickup_date, is_open, note) VALUES (?, 1, ?)')
      .run(iso, 'Demo week — edit the quantities or delete this pickup from the admin.');
    const pickupId = res.lastInsertRowid;
    const breads = db.prepare('SELECT id FROM breads WHERE active = 1').all();
    const insBatch = db.prepare(
      'INSERT INTO batch_items (pickup_id, bread_id, quantity_total, quantity_reserved) VALUES (?, ?, ?, 0)'
    );
    const demoQty = { }; // default 8 each, a couple lower to show the "low stock" state
    for (const b of breads) insBatch.run(pickupId, b.id, demoQty[b.id] ?? 8);
  });
  tx();
}

/** Seed the editable content pages, a sample market, and a starter gallery. */
export function seedContentIfEmpty() {
  if (db.prepare('SELECT COUNT(*) AS n FROM pages').get().n === 0) {
    const ins = db.prepare(
      'INSERT INTO pages (slug, title, body, in_nav, sort_order) VALUES (?, ?, ?, 1, ?)'
    );
    const pages = [
      ['about', 'About', [
        'We\'re a small-batch bakery in Dana Point, baking a handful of loaves each week the slow way — long ferments, simple ingredients, and a lot of patience.',
        'Everything is made by hand and baked fresh the morning of pickup. We keep the batches small on purpose: it\'s the only way to get the crust and crumb right.',
        '## Our promise',
        'Order by Thursday, pick up Saturday, still warm. That\'s it.',
      ].join('\n\n'), 3],
      ['process', 'Our Process', [
        'Good bread takes time — usually a day and a half from flour to loaf.',
        '## Slow ferment',
        'We build flavor with a natural sourdough starter and a long, cool overnight rise. No shortcuts, no commercial yeast.',
        '## Baked to order',
        'We only bake what\'s been ordered for the week, so nothing sits on a shelf. Your loaf comes out of the oven the morning you pick it up.',
      ].join('\n\n'), 2],
      ['storage-reheating', 'Storage & Reheating', [
        'Fresh bread with no preservatives is best the day you get it — but here\'s how to keep it great all week.',
        '## Storing',
        'Keep it cut-side down on a board for the first day or two. After that, slice what you need and freeze the rest in a zip bag — it freezes beautifully.',
        '## Reheating',
        'To bring back the crust: heat your oven to 375°F, run the loaf briefly under water (yes, really), and bake 8–10 minutes. For frozen slices, toast straight from the freezer.',
        '## What to avoid',
        'Skip the plastic bag on the counter — it softens the crust. And skip the fridge; it stales bread faster than room temperature.',
      ].join('\n\n'), 1],
      ['faq', 'FAQ', [
        '## How does ordering work?',
        'Order online by Thursday night, choose Saturday pickup, and pay with Venmo, PayPal, or card. We bake your loaves fresh Saturday morning.',
        '## Where do I pick up?',
        'Pickup is in Dana Point — we\'ll share the exact address after you order. Check "Where to Find Us" for any farmers-market dates too.',
        '## What if I need to cancel?',
        'Just reach out before Thursday and we\'ll sort it out.',
        '## Do you ship?',
        'Not yet — we\'re local pickup only for now, so the bread\'s at its best when you get it.',
      ].join('\n\n'), 4],
    ];
    const tx = db.transaction(() => pages.forEach((p) => ins.run(...p)));
    tx();
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM market_events').get().n === 0) {
    // A sample upcoming Saturday market so the "Find Us" page isn't empty.
    const now = new Date();
    const d = (6 - now.getDay() + 7) % 7;
    const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const iso = `${sat.getFullYear()}-${String(sat.getMonth() + 1).padStart(2, '0')}-${String(sat.getDate()).padStart(2, '0')}`;
    db.prepare(
      `INSERT INTO market_events (title, location_name, address, event_date, start_time, end_time, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('Dana Point Farmers Market', 'La Plaza Park', 'Dana Point, CA', iso, '9:00 AM', '1:00 PM',
      'Come say hi — we\'ll have extra loaves and pastries. (Example event — edit in the admin.)');
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM gallery_posts').get().n === 0) {
    const ins = db.prepare(
      'INSERT INTO gallery_posts (image_url, caption, sort_order) VALUES (?, ?, ?)'
    );
    const shots = [
      ['/uploads/seed-sourdough.jpg', 'Classic sourdough, fresh out of the oven', 1],
      ['/uploads/seed-baguette.jpg', 'Baguettes cooling on the rack', 2],
      ['/uploads/seed-cinnamon.jpg', 'Cinnamon raisin swirl', 3],
      ['/uploads/seed-jalapeno.jpg', 'Jalapeño cheddar, still bubbling', 4],
      ['/uploads/seed-wholewheat.jpg', 'Stone-milled whole wheat', 5],
    ];
    const tx = db.transaction(() => shots.forEach((s) => ins.run(...s)));
    tx();
  }
}
