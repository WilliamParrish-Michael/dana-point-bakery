/**
 * Public storefront API: read the shop, start checkout, capture payment.
 * All money is computed server-side from the DB; client totals are never trusted.
 */
import express from 'express';
import { getSetting } from './db.mjs';
import { navItems } from './render-page.mjs';
import {
  currentPickup,
  availabilityFor,
  reserveCart,
  attachPaypalOrder,
  markPaid,
  releaseOrder,
} from './inventory.mjs';
import {
  paypalConfigured,
  paypalPublic,
  createOrder,
  captureOrder,
  refundCapture,
} from './paypal.mjs';

export const shopRouter = express.Router();

function shopSettings() {
  return {
    shopName: getSetting('shop_name'),
    tagline: getSetting('tagline'),
    heroLine: getSetting('hero_line'),
    pickupLocation: getSetting('pickup_location'),
    pickupWindow: getSetting('pickup_window'),
    orderInstructions: getSetting('order_instructions'),
    galleryHeading: getSetting('gallery_heading'),
    instagramUrl: getSetting('instagram_url'),
    facebookUrl: getSetting('facebook_url'),
    contactEmail: getSetting('contact_email'),
  };
}

/** Front-end bootstrap: settings, PayPal client config, current pickup + stock. */
shopRouter.get('/api/shop', (req, res) => {
  const pickup = currentPickup();
  res.json({
    settings: shopSettings(),
    nav: navItems(),
    paypal: paypalConfigured
      ? { clientId: paypalPublic.clientId, currency: paypalPublic.currency, env: paypalPublic.env }
      : null,
    pickup: pickup
      ? { id: pickup.id, date: pickup.pickup_date, note: pickup.note }
      : null,
    breads: pickup ? availabilityFor(pickup.id) : [],
  });
});

/** Step 1 — reserve the cart + create a PayPal order. */
shopRouter.post('/api/checkout/create', async (req, res) => {
  if (!paypalConfigured) return res.status(503).json({ error: 'Payments are not set up yet.' });
  const pickup = currentPickup();
  if (!pickup) return res.status(409).json({ error: 'Ordering is closed right now.' });

  const { cart, customer } = req.body || {};
  if (!Array.isArray(cart) || cart.length === 0)
    return res.status(400).json({ error: 'Your cart is empty.' });
  if (!customer?.name || !customer?.email)
    return res.status(400).json({ error: 'Name and email are required.' });

  let reserved;
  try {
    reserved = reserveCart(pickup.id, cart, customer);
  } catch (err) {
    if (String(err.message).startsWith('SOLD_OUT:'))
      return res.status(409).json({ error: `Sold out this week: ${err.message.slice(9)}` });
    if (err.message === 'EMPTY') return res.status(400).json({ error: 'Your cart is empty.' });
    return res.status(409).json({ error: 'One or more items are unavailable.' });
  }

  try {
    const paypalOrderId = await createOrder({
      totalCents: reserved.totalCents,
      items: reserved.items,
      reference: `order-${reserved.orderId}`,
    });
    attachPaypalOrder(reserved.orderId, paypalOrderId);
    res.json({ paypalOrderId, orderId: reserved.orderId, totalCents: reserved.totalCents });
  } catch (err) {
    releaseOrder(reserved.orderId); // give the loaves back
    console.error('[checkout] create failed:', err.message);
    res.status(502).json({ error: 'Could not reach PayPal. Please try again.' });
  }
});

/** Step 2 — capture the approved payment. */
shopRouter.post('/api/checkout/capture', async (req, res) => {
  const { orderId, paypalOrderId } = req.body || {};
  if (!orderId || !paypalOrderId) return res.status(400).json({ error: 'Missing order reference.' });

  let result;
  try {
    result = await captureOrder(paypalOrderId);
  } catch (err) {
    console.error('[checkout] capture error:', err.message);
    return res.status(502).json({ error: 'Payment could not be confirmed. Please try again.' });
  }

  if (!result.ok) {
    releaseOrder(Number(orderId));
    return res.status(402).json({ error: 'Payment was not completed.' });
  }

  markPaid(Number(orderId), result.captureId);
  res.json({ ok: true, orderId: Number(orderId) });
});
