/**
 * Dana Point Bakery — weekly bread pre-order with PayPal/Venmo checkout.
 * Self-contained: Express + SQLite, no external services except PayPal.
 *
 *   npm install && npm start   →   http://localhost:3000  (store)
 *                                   http://localhost:3000/admin  (baker)
 */
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { seedIfEmpty, seedDemoPickupIfEmpty, seedContentIfEmpty } from './src/db.mjs';
import { sweepStaleReservations } from './src/inventory.mjs';
import { UPLOAD_DIR } from './src/uploads.mjs';
import { shopRouter } from './src/routes-shop.mjs';
import { adminRouter } from './src/routes-admin.mjs';
import { adminContentRouter } from './src/routes-admin-content.mjs';
import { contentRouter } from './src/routes-content.mjs';
import { paypalConfigured } from './src/paypal.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.use(shopRouter);
app.use(adminRouter);
app.use(adminContentRouter);

// Uploaded bread photos (kept with the DB under data/ so one folder = the whole shop)
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// /admin → the baker console (static single-page tool)
app.get('/admin', (req, res) => res.sendFile(join(__dirname, 'public', 'admin.html')));

// Server-rendered content pages + Find Us + JSON feeds. Its /:slug catch-all
// checks the DB and falls through to static for anything that isn't a page.
app.use(contentRouter);
app.use(express.static(join(__dirname, 'public')));

seedIfEmpty();
seedDemoPickupIfEmpty();
seedContentIfEmpty();
setInterval(() => {
  const released = sweepStaleReservations();
  if (released) console.log(`[sweep] released ${released} abandoned reservation(s)`);
}, 5 * 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  🍞 Dana Point Bakery running on http://localhost:${PORT}`);
  console.log(`     Store:  http://localhost:${PORT}/`);
  console.log(`     Admin:  http://localhost:${PORT}/admin`);
  if (!paypalConfigured)
    console.log('     ⚠  PayPal not configured — set PAYPAL_CLIENT_ID/SECRET in .env to take payments.\n');
  else console.log(`     💳 PayPal: ${process.env.PAYPAL_ENV || 'sandbox'} mode\n`);
});
