# 🍞 Dana Point Bakery — Weekly Bread Ordering

A small, self-contained website for taking **weekly bread pre-orders** with online
payment (**Venmo, PayPal, or card**) and **Saturday pickup**. The baker sets which
breads are offered and how many of each are baked per week; the storefront won't let
customers order more than that.

Everything runs in **one Node app with a single SQLite file** — no accounts, no
external database, no monthly SaaS. Copy the folder to back it up; hand over the
folder + credentials to transfer ownership.

---

## What it does

- **Storefront** (`/`) — customers see this week's breads, prices, and how many are
  left, add loaves to an order, enter their name/email, and pay with Venmo/PayPal/card.
- **Baker admin** (`/admin`, password-protected) —
  - **Breads:** add/edit **as many bread types as you want** (5, 25, more) — each
    with its own name, **price you set**, description, and photo you **upload** right
    from the form (or paste an image URL).
  - **This Week's Batch:** add a Saturday pickup date and set how many of each bread
    you're baking. Pause/reopen ordering anytime.
  - **Orders:** see who ordered what, revenue, a "to bake" tally, and mark orders
    picked up.
  - **Shop Settings:** shop name, tagline, pickup location/time, instructions.
- **No overselling:** loaves are reserved the moment a customer starts checkout and
  released automatically if they don't pay within 20 minutes. Two people can't buy
  the last loaf. All prices are computed on the server — the browser can't change them.

---

## Setup (local)

1. Install [Node.js](https://nodejs.org) 18+.
2. In this folder: `npm install`
3. Copy `.env.example` to `.env` and fill it in (see **PayPal** below).
4. `npm start`
5. Open **http://localhost:3000** (store) and **http://localhost:3000/admin** (baker).

The database is created automatically at `data/bakery.db` and seeded with a few
example breads you can edit or delete.

---

## PayPal (this is what enables Venmo)

Venmo has no standalone API — the only way to accept Venmo online is through
**PayPal Checkout**, which gives you PayPal + Venmo + cards in one integration.

1. The baker creates a free **PayPal Business account** at paypal.com.
2. Go to **developer.paypal.com → Apps & Credentials**.
   - Use the **Sandbox** tab to get test credentials for trying it out (fake money).
   - Use the **Live** tab for real payments once ready.
3. Create an app, copy the **Client ID** and **Secret** into `.env`:
   ```
   PAYPAL_ENV=sandbox            # or "live" for real money
   PAYPAL_CLIENT_ID=...
   PAYPAL_CLIENT_SECRET=...
   ```
4. Restart the app. The PayPal/Venmo buttons appear at checkout automatically.

> Venmo shows up as a button for U.S. customers on mobile and most desktop browsers.
> PayPal handles all card/Venmo data — this app never sees or stores card numbers.

**Fees:** PayPal/Venmo checkout is roughly **2.9% + $0.30** per order (confirm current
rates with PayPal). Money lands in the baker's PayPal balance.

---

## Deploying (handover)

It runs anywhere Node runs. Easiest options:

- **Render / Railway / Fly.io:** point it at this folder, set the `.env` values as
  environment variables, and add a **persistent disk** mounted at `/data` (or wherever
  `data/` lives) so the SQLite file survives restarts.
- **A small VPS:** `npm install && npm start` behind nginx; use `pm2` to keep it running.

Set `NODE_ENV=production` in the hosting environment so the login cookie is marked secure
(the site must be served over HTTPS).

**To hand the whole thing to the baker or their web person:** give them this folder, the
`.env` values, and the `data/bakery.db` file. There's nothing else — no separate database,
no third-party dashboard except PayPal (which is the baker's own account).

---

## Notes / decisions

- **Tax:** off by default. CA bakery items sold for off-premises consumption are generally
  not taxable — confirm with the baker's accountant. Set `TAX_RATE` in `.env` if needed.
- **Email confirmations:** the storefront shows an on-screen confirmation and the baker sees
  every order in the admin. Automated confirmation emails aren't wired up (they'd need an
  email service like SendGrid/Postmark) — easy to add later if wanted.
- **Photos:** uploaded bread photos are stored in `data/uploads/`, alongside the
  database. On a host, keep `data/` on a persistent disk so both the DB and photos
  survive restarts. Max 6 MB per photo (JPG/PNG/WEBP/GIF).
- **Sample photos:** the five seed images in `data/uploads/seed-*.jpg` are from
  Unsplash (free for commercial use, no attribution required). They're placeholders —
  the baker should replace them with photos of his own bread.
- **Backups:** copy the `data/` folder (the `.db` file + `uploads/`). That's the whole shop.
- **Admin password:** set `ADMIN_PASSWORD` in `.env`. One baker, one password.
