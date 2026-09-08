/* Dana Point Bread — storefront logic (vanilla JS, no build step). */
(() => {
  const $ = (id) => document.getElementById(id);
  const money = (c) => '$' + (c / 100).toFixed(2);
  const state = { shop: null, breads: [], cart: new Map(), paypalReady: false };

  /* ── boot ─────────────────────────────────────────── */
  async function boot() {
    const res = await fetch('/api/shop');
    const data = await res.json();
    state.shop = data;
    state.breads = data.breads || [];

    const s = data.settings;
    document.title = `${s.shopName} — Weekly Order`;
    $('brand-name').textContent = s.shopName;
    $('foot-name').textContent = s.shopName;
    $('foot-window').textContent = s.pickupWindow;
    $('hero-title').textContent = s.shopName;
    $('hero-tagline').textContent = s.tagline;
    $('pk-loc').textContent = s.pickupLocation;
    $('pk-window').textContent = s.pickupWindow;

    if (data.pickup) {
      $('pk-date').textContent = formatDate(data.pickup.date);
      $('pickup-card').hidden = false;
    } else {
      $('closed-banner').hidden = false;
      $('menu-sub').textContent = 'Ordering opens again soon.';
    }

    renderBreads();
    wireCart();
    if (data.paypal) loadPayPal(data.paypal);
  }

  function formatDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  }

  /* ── bread grid ───────────────────────────────────── */
  function renderBreads() {
    const grid = $('bread-grid');
    grid.innerHTML = '';
    if (!state.breads.length) {
      grid.innerHTML = '<p class="sub">No loaves listed for this week yet — check back soon.</p>';
      return;
    }
    for (const b of state.breads) {
      const remaining = Number(b.remaining) || 0;
      const inCart = state.cart.get(b.id)?.quantity || 0;
      const canAdd = remaining - inCart > 0;
      const card = document.createElement('article');
      card.className = 'bread' + (remaining <= 0 ? ' soldout' : '');
      card.innerHTML = `
        <div class="photo" ${b.photo_url ? `style="background-image:url('${escapeAttr(b.photo_url)}')"` : ''}>${b.photo_url ? '' : '🥖'}</div>
        <div class="body">
          <h3>${escapeHtml(b.name)}</h3>
          <p class="desc">${escapeHtml(b.description || '')}</p>
          <div class="row">
            <span class="price">${money(b.price_cents)}</span>
            ${remaining <= 0
              ? '<span class="soldout-tag">Sold out</span>'
              : `<span class="left ${remaining <= 3 ? 'low' : ''}">${remaining} left</span>`}
          </div>
          <div class="row">
            ${remaining <= 0 ? '' : `<button class="add-btn" data-add="${b.id}" ${canAdd ? '' : 'disabled'}>Add to order</button>`}
          </div>
        </div>`;
      grid.appendChild(card);
    }
    grid.querySelectorAll('[data-add]').forEach((btn) =>
      btn.addEventListener('click', () => addToCart(Number(btn.dataset.add)))
    );
  }

  /* ── cart ─────────────────────────────────────────── */
  function addToCart(id) {
    const bread = state.breads.find((b) => b.id === id);
    if (!bread) return;
    const cur = state.cart.get(id) || { ...bread, quantity: 0 };
    if (cur.quantity + 1 > bread.remaining) return; // respect stock
    cur.quantity += 1;
    state.cart.set(id, cur);
    renderBreads();
    renderCart();
    openDrawer();
  }
  function setQty(id, q) {
    const bread = state.breads.find((b) => b.id === id);
    const item = state.cart.get(id);
    if (!item) return;
    q = Math.max(0, Math.min(q, bread ? bread.remaining : q));
    if (q === 0) state.cart.delete(id);
    else item.quantity = q;
    renderBreads();
    renderCart();
  }

  function cartTotalCents() {
    let t = 0;
    for (const it of state.cart.values()) t += it.price_cents * it.quantity;
    return t;
  }
  function cartCount() {
    let n = 0;
    for (const it of state.cart.values()) n += it.quantity;
    return n;
  }

  function renderCart() {
    const n = cartCount();
    $('cart-count').textContent = n;
    $('cart-btn').disabled = n === 0 && !state.shop?.pickup;
    $('cart-total').textContent = money(cartTotalCents());

    const box = $('cart-items');
    if (state.cart.size === 0) {
      box.innerHTML = '<p class="empty-cart">Your order is empty.<br>Add a loaf to get started.</p>';
      $('checkout').style.display = 'none';
      return;
    }
    $('checkout').style.display = 'block';
    box.innerHTML = '';
    for (const it of state.cart.values()) {
      const row = document.createElement('div');
      row.className = 'line';
      row.innerHTML = `
        <div>
          <div class="name">${escapeHtml(it.name)}</div>
          <div class="meta">${money(it.price_cents)} each</div>
          <button class="rm" data-rm="${it.id}">Remove</button>
        </div>
        <div class="qty">
          <button data-dec="${it.id}" aria-label="Decrease">−</button>
          <span>${it.quantity}</span>
          <button data-inc="${it.id}" aria-label="Increase">+</button>
        </div>
        <div class="line-total">${money(it.price_cents * it.quantity)}</div>`;
      box.appendChild(row);
    }
    box.querySelectorAll('[data-inc]').forEach((b) =>
      b.addEventListener('click', () => setQty(Number(b.dataset.inc), (state.cart.get(Number(b.dataset.inc))?.quantity || 0) + 1))
    );
    box.querySelectorAll('[data-dec]').forEach((b) =>
      b.addEventListener('click', () => setQty(Number(b.dataset.dec), (state.cart.get(Number(b.dataset.dec))?.quantity || 0) - 1))
    );
    box.querySelectorAll('[data-rm]').forEach((b) =>
      b.addEventListener('click', () => setQty(Number(b.dataset.rm), 0))
    );
  }

  function wireCart() {
    $('cart-btn').addEventListener('click', openDrawer);
    $('drawer-close').addEventListener('click', closeDrawer);
    $('overlay').addEventListener('click', closeDrawer);
    renderCart();
  }
  function openDrawer() { $('drawer').classList.add('open'); $('overlay').classList.add('open'); }
  function closeDrawer() { $('drawer').classList.remove('open'); $('overlay').classList.remove('open'); }

  /* ── PayPal ───────────────────────────────────────── */
  function loadPayPal({ clientId, currency }) {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${currency}&enable-funding=venmo&components=buttons`;
    s.onload = renderPayPalButtons;
    s.onerror = () => showErr('Could not load the payment options. Refresh to try again.');
    document.head.appendChild(s);
  }

  function customer() {
    return {
      name: $('c-name').value.trim(),
      email: $('c-email').value.trim(),
      phone: $('c-phone').value.trim(),
      note: $('c-note').value.trim(),
    };
  }
  function showErr(msg) { const e = $('pay-err'); e.textContent = msg; e.hidden = false; }
  function clearErr() { $('pay-err').hidden = true; }

  function renderPayPalButtons() {
    if (!window.paypal) return;
    state.paypalReady = true;
    let pendingOrderId = null;

    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'pay' },

      onClick: (data, actions) => {
        clearErr();
        const c = customer();
        if (state.cart.size === 0) { showErr('Your order is empty.'); return actions.reject(); }
        if (!c.name || !c.email) { showErr('Please enter your name and email first.'); return actions.reject(); }
        return actions.resolve();
      },

      createOrder: async () => {
        const cart = [...state.cart.values()].map((it) => ({ breadId: it.id, quantity: it.quantity }));
        const res = await fetch('/api/checkout/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cart, customer: customer() }),
        });
        const data = await res.json();
        if (!res.ok) { showErr(data.error || 'Could not start checkout.'); throw new Error(data.error); }
        pendingOrderId = data.orderId;
        return data.paypalOrderId;
      },

      onApprove: async (data) => {
        const res = await fetch('/api/checkout/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: pendingOrderId, paypalOrderId: data.orderID }),
        });
        const out = await res.json();
        if (!res.ok || !out.ok) { showErr(out.error || 'Payment could not be confirmed.'); return; }
        showConfirmation(out.orderId);
      },

      onError: () => showErr('Something went wrong with the payment. Please try again.'),
    }).render('#paypal-buttons');
  }

  function showConfirmation(orderId) {
    state.cart.clear();
    $('pay-form').style.display = 'none';
    $('cart-total').closest('.checkout').querySelector('.totals').style.display = 'none';
    $('confirm').hidden = false;
    $('confirm-text').textContent =
      `Thanks! Order #${orderId} is reserved for Saturday pickup. Bring your name — we'll have it bagged and ready.`;
    $('cart-count').textContent = '0';
  }

  /* ── escaping ─────────────────────────────────────── */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }

  boot().catch((err) => {
    console.error(err);
    $('bread-grid').innerHTML = '<p class="sub">Sorry — the shop couldn\'t load. Please refresh.</p>';
  });
})();
