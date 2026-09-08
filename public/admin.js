/* Bakery admin — single-page console (vanilla JS). */
(() => {
  const $ = (id) => document.getElementById(id);
  const money = (c) => '$' + (c / 100).toFixed(2);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let editingBreadId = null;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ── auth ─────────────────────────────────────────── */
  async function checkSession() {
    const { signedIn } = await api('/api/admin/session');
    if (signedIn) showApp(); else showLogin();
  }
  function showLogin() { $('login').hidden = false; $('app').hidden = true; }
  function showApp() { $('login').hidden = true; $('app').hidden = false; loadAll(); }

  $('login-btn').addEventListener('click', login);
  $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  async function login() {
    $('login-err').hidden = true;
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: $('pw').value } });
      $('pw').value = '';
      showApp();
    } catch (err) { $('login-err').textContent = err.message; $('login-err').hidden = false; }
  }
  $('logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); showLogin(); });

  /* ── tabs ─────────────────────────────────────────── */
  document.querySelectorAll('nav.tabs button').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${btn.dataset.tab}`));
    })
  );

  /* ── load everything ──────────────────────────────── */
  let pickups = [];
  async function loadAll() {
    pickups = await api('/api/admin/pickups');
    fillPickupSelectors();
    await Promise.all([loadOrders(), loadBreads(), loadSettings(), loadPages(), loadEvents(), loadGallery()]);
    if (pickups[0]) loadBatch(pickups[0].id);
  }
  function fillPickupSelectors() {
    const opts = pickups.map((p) => `<option value="${p.id}">${fmtDate(p.pickup_date)}${p.is_open ? '' : ' (closed)'}</option>`).join('');
    $('order-pickup').innerHTML = opts || '<option value="">No pickups yet</option>';
    $('batch-pickup').innerHTML = opts || '<option value="">Add a date first</option>';
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /* ── orders ───────────────────────────────────────── */
  $('order-pickup').addEventListener('change', (e) => loadOrders(e.target.value));
  async function loadOrders(pickupId) {
    pickupId = pickupId || $('order-pickup').value;
    if (!pickupId) { $('orders-list').innerHTML = '<p class="muted">No pickups yet.</p>'; $('orders-summary').textContent = ''; return; }
    const orders = await api(`/api/admin/orders?pickupId=${pickupId}`);
    const paid = orders.filter((o) => o.status === 'paid' || o.status === 'picked_up');
    const revenue = paid.reduce((s, o) => s + o.total_cents, 0);
    const loaves = {};
    for (const o of paid) for (const it of o.items) loaves[it.name_snapshot] = (loaves[it.name_snapshot] || 0) + it.quantity;
    const bake = Object.entries(loaves).map(([n, q]) => `${q}× ${esc(n)}`).join(' · ') || 'nothing yet';
    $('orders-summary').innerHTML = `<strong>${paid.length}</strong> paid order(s) · <strong>${money(revenue)}</strong> · To bake: ${bake}`;

    if (!orders.length) { $('orders-list').innerHTML = '<p class="muted">No orders for this pickup yet.</p>'; return; }
    $('orders-list').innerHTML = `
      <table><thead><tr><th>#</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${orders.map(orderRow).join('')}</tbody></table>`;
    $('orders-list').querySelectorAll('[data-mark]').forEach((b) =>
      b.addEventListener('click', async () => {
        await api(`/api/admin/orders/${b.dataset.id}`, { method: 'PATCH', body: { status: b.dataset.mark } });
        toast('Order updated'); loadOrders();
      })
    );
  }
  function orderRow(o) {
    const items = o.items.map((it) => `${it.quantity}× ${esc(it.name_snapshot)}`).join(', ');
    const contact = [esc(o.customer_email), esc(o.customer_phone)].filter(Boolean).join(' · ');
    const action = o.status === 'paid'
      ? `<button class="btn small ghost" data-mark="picked_up" data-id="${o.id}">Mark picked up</button>`
      : '';
    return `<tr>
      <td>${o.id}</td>
      <td><strong>${esc(o.customer_name)}</strong><div class="muted">${contact}</div>${o.note ? `<div class="muted">“${esc(o.note)}”</div>` : ''}</td>
      <td>${items}</td>
      <td>${money(o.total_cents)}</td>
      <td><span class="pill ${o.status}">${o.status.replace('_', ' ')}</span></td>
      <td>${action}</td>
    </tr>`;
  }

  /* ── batch ────────────────────────────────────────── */
  $('add-pickup').addEventListener('click', async () => {
    const date = $('new-pickup-date').value;
    if (!date) return toast('Pick a date first');
    await api('/api/admin/pickups', { method: 'POST', body: { pickup_date: date } });
    toast('Pickup added');
    pickups = await api('/api/admin/pickups');
    fillPickupSelectors();
    $('batch-pickup').value = pickups.find((p) => p.pickup_date === date)?.id || '';
    loadBatch($('batch-pickup').value);
  });
  $('batch-pickup').addEventListener('change', (e) => loadBatch(e.target.value));
  $('pickup-open').addEventListener('change', async (e) => {
    const id = $('batch-pickup').value; if (!id) return;
    await api(`/api/admin/pickups/${id}`, { method: 'PATCH', body: { is_open: e.target.checked ? 1 : 0 } });
    toast(e.target.checked ? 'Ordering open' : 'Ordering paused');
    pickups = await api('/api/admin/pickups'); fillPickupSelectors();
  });

  async function loadBatch(pickupId) {
    if (!pickupId) { $('batch-table').querySelector('tbody').innerHTML = '<tr><td class="muted">Add a pickup date first.</td></tr>'; return; }
    const p = pickups.find((x) => String(x.id) === String(pickupId));
    $('pickup-open').checked = p ? !!p.is_open : false;
    const rows = await api(`/api/admin/batch/${pickupId}`);
    const tb = $('batch-table').querySelector('tbody');
    if (!rows.length) { tb.innerHTML = '<tr><td class="muted">Add breads first (Breads tab).</td></tr>'; return; }
    tb.innerHTML = `<tr><th>Bread</th><th>Baking</th><th>Ordered</th><th>Left</th><th></th></tr>` +
      rows.map((r) => `<tr>
        <td><strong>${esc(r.name)}</strong> <span class="muted">${money(r.price_cents)}</span></td>
        <td><input class="qtyin" type="number" min="${r.quantity_reserved}" value="${r.quantity_total}" data-bread="${r.bread_id}"></td>
        <td>${r.quantity_reserved}</td>
        <td>${Math.max(0, r.quantity_total - r.quantity_reserved)}</td>
        <td><button class="btn small" data-save="${r.bread_id}">Save</button></td>
      </tr>`).join('');
    tb.querySelectorAll('[data-save]').forEach((b) =>
      b.addEventListener('click', async () => {
        const input = tb.querySelector(`input[data-bread="${b.dataset.save}"]`);
        try {
          await api(`/api/admin/batch/${pickupId}`, { method: 'POST', body: { bread_id: Number(b.dataset.save), quantity_total: Number(input.value) } });
          toast('Saved'); loadBatch(pickupId);
        } catch (err) { toast(err.message); }
      })
    );
  }

  /* ── breads ───────────────────────────────────────── */
  async function loadBreads() {
    const breads = await api('/api/admin/breads');
    const tb = $('breads-table').querySelector('tbody');
    const active = breads.filter((b) => b.active);
    tb.innerHTML = `<tr><th>Bread</th><th>Price</th><th></th></tr>` + (active.length
      ? active.map((b) => `<tr>
          <td><strong>${esc(b.name)}</strong><div class="muted">${esc(b.description || '')}</div></td>
          <td>${money(b.price_cents)}</td>
          <td class="row" style="justify-content:flex-end">
            <button class="btn small ghost" data-edit='${esc(JSON.stringify(b))}'>Edit</button>
            <button class="btn small danger" data-del="${b.id}">Remove</button>
          </td></tr>`).join('')
      : '<tr><td class="muted">No breads yet — add your first above.</td></tr>');
    tb.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => startEdit(JSON.parse(btn.dataset.edit))));
    tb.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
      await api(`/api/admin/breads/${btn.dataset.del}`, { method: 'DELETE' }); toast('Removed'); loadBreads(); loadAll();
    }));
  }
  function startEdit(b) {
    editingBreadId = b.id;
    $('bread-form-title').textContent = `Edit ${b.name}`;
    $('b-name').value = b.name; $('b-price').value = (b.price_cents / 100).toFixed(2);
    $('b-desc').value = b.description || ''; $('b-photo').value = b.photo_url || '';
    setPhotoPreview(b.photo_url || '');
    $('cancel-edit').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('cancel-edit').addEventListener('click', resetBreadForm);
  function resetBreadForm() {
    editingBreadId = null;
    $('bread-form-title').textContent = 'Add a bread';
    ['b-name', 'b-price', 'b-desc', 'b-photo'].forEach((id) => ($(id).value = ''));
    $('b-photo-file').value = ''; setPhotoPreview(''); $('upload-status').hidden = true;
    $('cancel-edit').hidden = true; $('bread-err').hidden = true;
  }

  /* photo: upload a file, or paste a URL — both feed the b-photo value + preview */
  function setPhotoPreview(url) {
    const img = $('b-photo-preview');
    if (url) { img.src = url; img.style.display = 'block'; }
    else { img.removeAttribute('src'); img.style.display = 'none'; }
  }
  $('b-photo').addEventListener('input', () => setPhotoPreview($('b-photo').value.trim()));
  $('b-photo-file').addEventListener('change', async () => {
    const file = $('b-photo-file').files[0];
    if (!file) return;
    const status = $('upload-status');
    status.hidden = false; status.textContent = 'Uploading…';
    try {
      const fd = new FormData(); fd.append('image', file);
      const res = await fetch('/api/admin/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      $('b-photo').value = data.url; setPhotoPreview(data.url);
      status.textContent = 'Photo uploaded ✓';
    } catch (err) { status.textContent = err.message; }
  });
  $('save-bread').addEventListener('click', async () => {
    $('bread-err').hidden = true;
    const name = $('b-name').value.trim();
    if (!name) { $('bread-err').textContent = 'Name is required.'; $('bread-err').hidden = false; return; }
    const body = {
      name, description: $('b-desc').value.trim(),
      price_cents: Math.round(parseFloat($('b-price').value || '0') * 100),
      photo_url: $('b-photo').value.trim(), active: 1,
    };
    try {
      if (editingBreadId) await api(`/api/admin/breads/${editingBreadId}`, { method: 'PUT', body: { ...body, sort_order: 0 } });
      else await api('/api/admin/breads', { method: 'POST', body });
      toast('Saved'); resetBreadForm(); loadBreads(); loadAll();
    } catch (err) { $('bread-err').textContent = err.message; $('bread-err').hidden = false; }
  });

  /* ── settings ─────────────────────────────────────── */
  const SKEYS = ['shop_name', 'tagline', 'hero_line', 'pickup_location', 'pickup_window',
    'order_instructions', 'gallery_heading', 'instagram_url', 'facebook_url', 'contact_email'];
  async function loadSettings() {
    const s = await api('/api/admin/settings');
    for (const k of SKEYS) $('s-' + k).value = s[k] || '';
  }
  $('save-settings').addEventListener('click', async () => {
    const body = {}; for (const k of SKEYS) body[k] = $('s-' + k).value;
    await api('/api/admin/settings', { method: 'PUT', body }); toast('Saved');
  });

  /* ── pages ────────────────────────────────────────── */
  let pagesData = [];
  async function loadPages() {
    pagesData = await api('/api/admin/pages');
    $('page-select').innerHTML = pagesData.map((p) => `<option value="${p.slug}">${esc(p.title)}</option>`).join('');
    if (pagesData[0]) selectPage(pagesData[0].slug);
  }
  $('page-select').addEventListener('change', (e) => selectPage(e.target.value));
  function selectPage(slug) {
    const p = pagesData.find((x) => x.slug === slug); if (!p) return;
    $('page-select').value = slug;
    $('page-title').value = p.title;
    $('page-body').value = p.body;
    $('page-innav').checked = !!p.in_nav;
    $('view-page').href = '/' + p.slug;
  }
  $('save-page').addEventListener('click', async () => {
    const slug = $('page-select').value; if (!slug) return;
    await api('/api/admin/pages/' + slug, { method: 'PUT', body: {
      title: $('page-title').value, body: $('page-body').value, in_nav: $('page-innav').checked ? 1 : 0 } });
    toast('Page saved'); loadPages();
  });

  /* ── events (Find Us) ─────────────────────────────── */
  let editingEventId = null;
  async function loadEvents() {
    const events = await api('/api/admin/events');
    const tb = $('events-table').querySelector('tbody');
    tb.innerHTML = '<tr><th>Date</th><th>Event</th><th></th></tr>' + (events.length
      ? events.map((e) => `<tr>
          <td>${esc(fmtDate(e.event_date))}</td>
          <td><strong>${esc(e.title)}</strong><div class="muted">${esc(e.location_name || '')}${e.start_time ? ' · ' + esc(e.start_time) : ''}</div></td>
          <td class="row" style="justify-content:flex-end">
            <button class="btn small ghost" data-edit-ev='${esc(JSON.stringify(e))}'>Edit</button>
            <button class="btn small danger" data-del-ev="${e.id}">Delete</button>
          </td></tr>`).join('')
      : '<tr><td class="muted">No markets yet — add one above.</td></tr>');
    tb.querySelectorAll('[data-edit-ev]').forEach((b) => b.addEventListener('click', () => startEditEvent(JSON.parse(b.dataset.editEv))));
    tb.querySelectorAll('[data-del-ev]').forEach((b) => b.addEventListener('click', async () => {
      await api('/api/admin/events/' + b.dataset.delEv, { method: 'DELETE' }); toast('Deleted'); loadEvents();
    }));
  }
  function eventForm() {
    return { title: $('ev-title').value.trim(), event_date: $('ev-date').value,
      location_name: $('ev-loc').value.trim(), address: $('ev-addr').value.trim(),
      start_time: $('ev-start').value.trim(), end_time: $('ev-end').value.trim(),
      note: $('ev-note').value.trim(), active: 1 };
  }
  function startEditEvent(e) {
    editingEventId = e.id; $('event-form-title').textContent = 'Edit event';
    $('ev-title').value = e.title; $('ev-date').value = e.event_date; $('ev-loc').value = e.location_name;
    $('ev-addr').value = e.address; $('ev-start').value = e.start_time; $('ev-end').value = e.end_time; $('ev-note').value = e.note;
    $('cancel-event').hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function resetEventForm() {
    editingEventId = null; $('event-form-title').textContent = 'Add a market / pop-up';
    ['ev-title', 'ev-date', 'ev-loc', 'ev-addr', 'ev-start', 'ev-end', 'ev-note'].forEach((id) => ($(id).value = ''));
    $('cancel-event').hidden = true; $('event-err').hidden = true;
  }
  $('cancel-event').addEventListener('click', resetEventForm);
  $('save-event').addEventListener('click', async () => {
    $('event-err').hidden = true;
    const body = eventForm();
    if (!body.title || !body.event_date) { $('event-err').textContent = 'Title and date are required.'; $('event-err').hidden = false; return; }
    try {
      if (editingEventId) await api('/api/admin/events/' + editingEventId, { method: 'PUT', body });
      else await api('/api/admin/events', { method: 'POST', body });
      toast('Saved'); resetEventForm(); loadEvents();
    } catch (err) { $('event-err').textContent = err.message; $('event-err').hidden = false; }
  });

  /* ── gallery ──────────────────────────────────────── */
  let galImageUrl = '';
  $('gal-file').addEventListener('change', async () => {
    const file = $('gal-file').files[0]; if (!file) return;
    const st = $('gal-upload-status'); st.hidden = false; st.textContent = 'Uploading…';
    try {
      const fd = new FormData(); fd.append('image', file);
      const res = await fetch('/api/admin/upload', { method: 'POST', body: fd });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Upload failed.');
      galImageUrl = data.url; $('gal-preview').src = data.url; $('gal-preview').style.display = 'block';
      $('save-gallery').disabled = false; st.textContent = 'Ready ✓';
    } catch (err) { st.textContent = err.message; }
  });
  $('save-gallery').addEventListener('click', async () => {
    if (!galImageUrl) return;
    await api('/api/admin/gallery', { method: 'POST', body: {
      image_url: galImageUrl, caption: $('gal-caption').value.trim(), link_url: $('gal-link').value.trim() } });
    toast('Added to gallery');
    galImageUrl = ''; $('gal-file').value = ''; $('gal-caption').value = ''; $('gal-link').value = '';
    $('gal-preview').style.display = 'none'; $('save-gallery').disabled = true; $('gal-upload-status').hidden = true;
    loadGallery();
  });
  async function loadGallery() {
    const posts = await api('/api/admin/gallery');
    const box = $('gallery-list');
    box.innerHTML = posts.length
      ? '<table><tbody><tr><th>Photo</th><th>Caption</th><th></th></tr>' + posts.map((p) => `<tr>
          <td><img src="${esc(p.image_url)}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--line)"></td>
          <td>${esc(p.caption || '')}${p.link_url ? `<div class="muted">${esc(p.link_url)}</div>` : ''}</td>
          <td class="row" style="justify-content:flex-end"><button class="btn small danger" data-del-gal="${p.id}">Remove</button></td>
        </tr>`).join('') + '</tbody></table>'
      : '<p class="muted">No photos yet — add one above.</p>';
    box.querySelectorAll('[data-del-gal]').forEach((b) => b.addEventListener('click', async () => {
      await api('/api/admin/gallery/' + b.dataset.delGal, { method: 'DELETE' }); toast('Removed'); loadGallery();
    }));
  }

  checkSession().catch(() => showLogin());
})();
