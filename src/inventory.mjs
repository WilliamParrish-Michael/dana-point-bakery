/**
 * Inventory + ordering logic — the part that must never oversell.
 *
 * Model: loaves are *reserved* the moment a customer starts PayPal checkout
 * (atomic guarded UPDATE), and released if they don't pay. Paid orders keep
 * their reservation. Availability = quantity_total - quantity_reserved.
 *
 * This prevents two people buying the last loaf, and prevents abandoned carts
 * from holding stock forever (a sweep releases stale pending orders).
 */
import { db } from './db.mjs';

const RESERVATION_TTL_MIN = 20; // pending (unpaid) orders release after this

/** The store's current open pickup (soonest open Saturday). Null if none set. */
export function currentPickup() {
  return db
    .prepare(
      `SELECT * FROM pickups
       WHERE is_open = 1 AND pickup_date >= date('now','localtime')
       ORDER BY pickup_date ASC LIMIT 1`
    )
    .get();
}

/** Storefront listing: active breads with remaining count for a pickup. */
export function availabilityFor(pickupId) {
  return db
    .prepare(
      `SELECT b.id, b.name, b.description, b.price_cents, b.photo_url,
              COALESCE(bi.quantity_total, 0)                                AS total,
              COALESCE(bi.quantity_total, 0) - COALESCE(bi.quantity_reserved, 0) AS remaining
       FROM breads b
       LEFT JOIN batch_items bi ON bi.bread_id = b.id AND bi.pickup_id = ?
       WHERE b.active = 1
       ORDER BY b.sort_order, b.id`
    )
    .all(pickupId);
}

/**
 * Reserve a cart and create a pending order in one transaction.
 * Prices are read from the DB here — the client's numbers are never trusted.
 * @param {number} pickupId
 * @param {Array<{breadId:number, quantity:number}>} lines
 * @param {object} customer  { name, email, phone, note }
 * @returns {{ orderId:number, totalCents:number, items:Array }}
 * @throws Error('SOLD_OUT:<name>') | Error('EMPTY') | Error('UNAVAILABLE')
 */
export const reserveCart = db.transaction((pickupId, lines, customer) => {
  const clean = lines
    .map((l) => ({ breadId: Number(l.breadId), quantity: Math.floor(Number(l.quantity)) }))
    .filter((l) => l.breadId > 0 && l.quantity > 0);
  if (clean.length === 0) throw new Error('EMPTY');

  const taxRate = Number(process.env.TAX_RATE || 0);
  const items = [];
  let subtotal = 0;

  const guardedReserve = db.prepare(
    `UPDATE batch_items SET quantity_reserved = quantity_reserved + @qty
     WHERE pickup_id = @pickup AND bread_id = @bread
       AND quantity_total - quantity_reserved >= @qty`
  );
  const getBread = db.prepare('SELECT id, name, price_cents FROM breads WHERE id = ? AND active = 1');

  for (const line of clean) {
    const bread = getBread.get(line.breadId);
    if (!bread) throw new Error('UNAVAILABLE');
    const info = guardedReserve.run({
      qty: line.quantity,
      pickup: pickupId,
      bread: line.breadId,
    });
    if (info.changes === 0) throw new Error(`SOLD_OUT:${bread.name}`);
    subtotal += bread.price_cents * line.quantity;
    items.push({
      breadId: bread.id,
      name: bread.name,
      unitCents: bread.price_cents,
      quantity: line.quantity,
    });
  }

  const totalCents = subtotal + Math.round(subtotal * taxRate);

  const orderRes = db
    .prepare(
      `INSERT INTO orders (pickup_id, customer_name, customer_email, customer_phone, note, status, total_cents)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(
      pickupId,
      (customer.name || '').slice(0, 120),
      (customer.email || '').slice(0, 160),
      (customer.phone || '').slice(0, 40),
      (customer.note || '').slice(0, 500),
      totalCents
    );
  const orderId = orderRes.lastInsertRowid;

  const insItem = db.prepare(
    `INSERT INTO order_items (order_id, bread_id, name_snapshot, unit_price_cents, quantity)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const it of items) insItem.run(orderId, it.breadId, it.name, it.unitCents, it.quantity);

  return { orderId: Number(orderId), totalCents, items };
});

/** Attach the PayPal order id to our pending order. */
export function attachPaypalOrder(orderId, paypalOrderId) {
  db.prepare('UPDATE orders SET paypal_order_id = ? WHERE id = ?').run(paypalOrderId, orderId);
}

/** Mark an order paid (reservation already counted; nothing to change in batch). */
export const markPaid = db.transaction((orderId, captureId) => {
  db.prepare(
    `UPDATE orders SET status = 'paid', paypal_capture_id = ?, paid_at = datetime('now')
     WHERE id = ? AND status = 'pending'`
  ).run(captureId, orderId);
});

/** Release a pending order's reservations (payment failed/abandoned). */
export const releaseOrder = db.transaction((orderId) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'pending') return;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const release = db.prepare(
    `UPDATE batch_items SET quantity_reserved = MAX(0, quantity_reserved - ?)
     WHERE pickup_id = ? AND bread_id = ?`
  );
  for (const it of items) release.run(it.quantity, order.pickup_id, it.bread_id);
  db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`).run(orderId);
});

/** Sweep abandoned pending orders older than the TTL. Run on a timer. */
export function sweepStaleReservations() {
  const stale = db
    .prepare(
      `SELECT id FROM orders
       WHERE status = 'pending' AND created_at <= datetime('now', ?)`
    )
    .all(`-${RESERVATION_TTL_MIN} minutes`);
  for (const row of stale) releaseOrder(row.id);
  return stale.length;
}
