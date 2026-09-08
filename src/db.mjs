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
