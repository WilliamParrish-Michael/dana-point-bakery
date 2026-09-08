/**
 * Minimal PayPal Orders v2 REST client (no SDK dependency — just fetch).
 *
 * Handles: OAuth token, create order, capture order, refund a capture.
 * Works for PayPal, Venmo, and card funding — the funding source is chosen by the
 * buyer in the PayPal JS button on the front end; the server side is identical.
 */
const ENV = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase();
const BASE =
  ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const CURRENCY = process.env.CURRENCY || 'USD';

export const paypalConfigured = Boolean(CLIENT_ID && CLIENT_SECRET);
export const paypalPublic = { clientId: CLIENT_ID, currency: CURRENCY, env: ENV };

async function accessToken() {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

/**
 * Create a PayPal order for a server-computed total.
 * @param {{ totalCents:number, items:Array<{name:string, unitCents:number, quantity:number}>, reference:string }} order
 * @returns {Promise<string>} PayPal order id
 */
export async function createOrder({ totalCents, items, reference }) {
  const token = await accessToken();
  const money = (cents) => (cents / 100).toFixed(2);
  const itemTotal = items.reduce((s, i) => s + i.unitCents * i.quantity, 0);

  const body = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: reference,
        amount: {
          currency_code: CURRENCY,
          value: money(totalCents),
          breakdown: {
            item_total: { currency_code: CURRENCY, value: money(itemTotal) },
            ...(totalCents > itemTotal
              ? { tax_total: { currency_code: CURRENCY, value: money(totalCents - itemTotal) } }
              : {}),
          },
        },
        items: items.map((i) => ({
          name: i.name.slice(0, 127),
          quantity: String(i.quantity),
          unit_amount: { currency_code: CURRENCY, value: money(i.unitCents) },
          category: 'PHYSICAL_GOODS',
        })),
      },
    ],
  };

  const res = await fetch(`${BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PayPal create failed (${res.status}): ${await res.text()}`);
  return (await res.json()).id;
}

/**
 * Capture an approved order.
 * @returns {Promise<{ ok:boolean, captureId:string, raw:object }>}
 */
export async function captureOrder(paypalOrderId) {
  const token = await accessToken();
  const res = await fetch(`${BASE}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const raw = await res.json();
  const capture = raw?.purchase_units?.[0]?.payments?.captures?.[0];
  const ok = res.ok && raw.status === 'COMPLETED' && capture?.status === 'COMPLETED';
  return { ok, captureId: capture?.id || '', raw };
}

/** Refund a capture (used if we somehow oversold between capture and commit). */
export async function refundCapture(captureId) {
  try {
    const token = await accessToken();
    await fetch(`${BASE}/v2/payments/captures/${captureId}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[paypal] refund failed for', captureId, err.message);
  }
}
