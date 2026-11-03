// ============================================================================
// Admin — the shell, the overview, and the orders board.
//
// ⚠️ THE ORDERS BOARD LIVES HERE AND NOT IN admin-catalog.js, and that is not
// a filing decision. tools/honesty.pl allows orders.setPaid() to be called
// from exactly two files: backend-local.js, where it is defined, and this one.
// `paid` is the single field in this project that a human must assert, so the
// check keeps the number of places that can assert it down to one screen.
// Moving the board would mean widening that exemption, which is the wrong
// direction.
//
// ⚠️ NO seed.js, here or ever. kirana seeds demo orders so its counter board
// is not empty the first time somebody is shown it. Doing that here would put
// invented orders into a dashboard whose entire claim is that it never invents
// one. The empty state explains why it is empty instead.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, h1, notice, toast, $$ } from '../ui.js';
import { ornament } from '../brand.js';
import * as D from '../domain.js';
import * as O from '../overlay.js';
import { renderCatalogue, renderInventory, renderCategories, renderData, wireCatalogTab }
  from './admin-catalog.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'categories', label: 'Categories' },
  { id: 'data', label: 'Data' },
];

const tabHref = (id, q) => `#/admin/${id}${q ? '?' + q : ''}`;

function tabBar(active) {
  return `<nav class="adm-tabs" aria-label="Admin sections">
    ${TABS.map((t) => `<a href="${tabHref(t.id)}" class="adm-tab${t.id === active ? ' is-on' : ''}"
       ${t.id === active ? 'aria-current="page"' : ''}>${esc(t.label)}</a>`).join('')}
  </nav>`;
}

/**
 * The strip that says what the browser is holding over the shipped catalogue.
 * It is on every tab, because the one thing an owner must never do is edit for
 * an hour without realising nothing has been exported.
 */
function overlayStrip(state, edits) {
  if (state === 'none') return '';
  if (state === 'stale') {
    return notice('warn', `<b>${edits} unsaved edit${edits === 1 ? '' : 's'},
      held back.</b> They were made against an older <code>catalog.json</code>
      than the one now loaded, so they are <b>not</b> being applied — the shop
      is showing the shipped catalogue.
      <a href="${tabHref('data')}">Review them</a> and decide, field by field.`);
  }
  return notice('info', `<b>${edits} edit${edits === 1 ? '' : 's'} live in this
    browser only.</b> The shop here reflects them; nobody else sees them until
    you <a href="${tabHref('data')}">export the catalogue</a> and commit it.`);
}

// ---------------------------------------------------------------------------
// OVERVIEW
// ---------------------------------------------------------------------------
function renderOverview({ orders, all, shop, cats }) {
  const lowStock = all.filter((p) => p.kind !== 'voucher' && p.stock <= shop.lowStockAt);
  const open = orders.filter((o) => ['sent', 'confirmed', 'packed', 'shipped'].includes(o.status));
  const unpaid = orders.filter((o) => !o.paid && !['draft', 'cancelled', 'abandoned'].includes(o.status));

  return `
  ${notice('warn', '<b>These are orders placed in THIS browser only.</b> '
    + 'There is no server, so an order a customer places on their own phone '
    + 'never appears here — it reaches you on WhatsApp. Two tabs side by side '
    + 'make this look like it works, which is exactly why it is worth saying.')}

  <div class="adm-stats">
    ${stat('Products', all.length, tabHref('catalogue'))}
    ${stat('Categories', cats.length, tabHref('categories'))}
    ${stat('Open orders', open.length, tabHref('orders'))}
    ${stat('Awaiting payment', unpaid.length, tabHref('orders'))}
    ${stat('Low or out of stock', lowStock.length, tabHref('inventory'))}
    ${stat('On offer', all.filter((p) => p.mrp > p.price).length, tabHref('catalogue'))}
  </div>

  <div class="two-col" style="margin-top:var(--s6)">
    <section class="panel">
      <h2 class="t-h3">Needs attention</h2>
      ${lowStock.length || unpaid.length ? `
      <div class="totals" style="margin-top:var(--s4)">
        ${unpaid.map((o) => `<div class="total-row muted">
          <span><a href="${tabHref('orders')}">${esc(o.code)}</a> —
            not marked paid</span>
          <span>${D.rupees(o.grand)}</span></div>`).join('')}
        ${lowStock.map((p) => `<div class="total-row muted">
          <span><a href="${tabHref('catalogue', 'p=' + encodeURIComponent(p.id))}">${esc(p.name)}</a></span>
          <span>${p.stock === 0 ? 'out of stock' : p.stock + ' left'}</span></div>`).join('')}
      </div>` : `<p class="t-micro dim" style="margin-top:var(--s3)">
        Nothing is low on stock and no order is waiting on a payment check.</p>`}
    </section>

    <aside>
      <section class="panel">
        <h2 class="t-h3">Where the data lives</h2>
        <p class="t-micro dim" style="margin-top:var(--s2)">
          Everything the business owns is in <code>app/data/shop.json</code>
          and <code>app/data/catalog.json</code>. This admin edits a
          <b>patch set</b> over the catalogue rather than a copy of it, so a
          field you have not touched still picks up the next catalogue update.
          <a href="${tabHref('data')}">Export</a> turns the patches back into
          a file to commit.</p>
      </section>
    </aside>
  </div>`;
}

const stat = (label, n, href) => `<a class="adm-stat" href="${href}">
  <span class="adm-stat-n">${n}</span>
  <span class="adm-stat-l">${esc(label)}</span></a>`;

// ---------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------
function renderOrders({ orders, shop }) {
  if (!orders.length) {
    return `<section class="panel">
      <h2 class="t-h3">No orders in this browser</h2>
      <p class="t-micro dim" style="margin-top:var(--s3);max-width:60ch">
        This board will stay empty until somebody places an order in this
        browser. It is not seeded with invented orders, because a dashboard
        that invents orders cannot be trusted about the real ones — and this
        one has no server to get real ones from. A customer ordering on their
        own phone reaches you on WhatsApp.</p>
    </section>`;
  }

  return `<div class="adm-orders">
    ${orders.map((o) => {
    const next = D.ORDER_NEXT[o.status] || [];
    return `<section class="panel adm-order" data-oid="${esc(o.id)}">
      <header class="adm-order-head">
        <div>
          <a href="#/order/${esc(o.code)}" class="ord-code">${esc(o.code)}</a>
          <span class="pill pill-${D.STATUS_TONE[o.status]}">${esc(D.STATUS_LABEL[o.status])}</span>
          ${o.paid ? '<span class="pill pill-good">Paid</span>'
      : '<span class="pill pill-draft">Not marked paid</span>'}
        </div>
        <div class="ord-meta">${D.fmtStamp(o.createdAt)} ·
          ${esc(o.customer.name || 'No name given')} ·
          ${o.lines.length} line${o.lines.length === 1 ? '' : 's'} ·
          <b>${D.rupees(o.grand)}</b></div>
      </header>

      ${o.gatewayRef ? notice('warn', `<b>A gateway reported a payment
        (${esc(o.gatewayRef.paymentId)}).</b> It is recorded as
        <b>unverified</b> and does not mark this order paid. Verifying it needs
        an HMAC over the key secret on a server, which does not exist yet — so
        check the bank yourself before marking it paid.`) : ''}

      <div class="adm-order-lines">
        ${o.lines.map((l) => `<div class="total-row muted">
          <span>${esc(l.name)}${l.variantLabel ? ' · ' + esc(l.variantLabel) : ''}
            × ${l.qty}</span>
          <span>${D.rupees(l.lineTotal)}</span></div>`).join('')}
      </div>

      <div class="adm-order-acts">
        ${next.length ? next.map((to) => `<button class="btn btn-sm btn-secondary"
            data-advance="${esc(to)}">${esc(D.STATUS_LABEL[to])}</button>`).join('')
      : '<span class="t-micro dim">This order is finished — no further step.</span>'}

        <button class="btn btn-sm ${o.paid ? 'btn-ghost' : 'btn-primary'}"
          data-paid="${o.paid ? '0' : '1'}">
          ${o.paid ? 'Unmark paid' : 'Mark paid'}</button>
      </div>
      <p class="t-micro dim adm-paid-why">
        ${o.paid
      ? `Marked paid ${D.fmtStamp(o.paidAt)}${o.paidVia ? ' · ' + esc(o.paidVia) : ''}.
           Only you can set this, and only you can unset it.`
      : 'Mark this only after you have seen the money arrive. Nothing on this '
        + 'site can tell you that — there is no gateway and no server.'}</p>
    </section>`;
  }).join('')}
  </div>`;
}

/** Status changes and the one human-asserted field in the project. */
function wireOrders(host, repaint) {
  for (const btn of $$('[data-advance]', host)) {
    btn.addEventListener('click', async () => {
      const id = btn.closest('[data-oid]').dataset.oid;
      const to = btn.dataset.advance;
      try {
        await store.orders.advance(id, to);
        toast(`Moved to ${D.STATUS_LABEL[to]}.`);
        repaint();
      } catch (e) {
        // ⚠️ Shown, never swallowed. domain.js refuses an invalid transition
        // on purpose; a silent no-op is a button that looks like it worked.
        toast(String(e.message || e));
      }
    });
  }

  for (const btn of $$('[data-paid]', host)) {
    btn.addEventListener('click', async () => {
      const id = btn.closest('[data-oid]').dataset.oid;
      const to = btn.dataset.paid === '1';
      if (to && !confirmPaid(btn)) return;
      await store.orders.setPaid(id, to, to ? 'checked by hand' : null);
      toast(to ? 'Marked paid.' : 'No longer marked paid.');
      repaint();
    });
  }
}

/**
 * A two-tap confirm, inline. ⚠️ Not window.confirm(): the artifact and
 * single-file viewers return false from it immediately without showing
 * anything, so a dialog there would silently cancel every attempt.
 */
function confirmPaid(btn) {
  if (btn.dataset.armed === '1') return true;
  btn.dataset.armed = '1';
  const was = btn.textContent;
  btn.textContent = 'Seen it in the bank?';
  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.dataset.armed = '0';
    btn.textContent = was;
  }, 4000);
  return false;
}

// ---------------------------------------------------------------------------
// THE SCREEN
// ---------------------------------------------------------------------------
/**
 * ⚠️ WHICH ENTRY OF THIS SCREEN IS STILL THE CURRENT ONE.
 *
 * Every tab here is one screen, so moving between them re-enters `admin`
 * without the router ever swapping sections. draw() is async -- it awaits six
 * store reads -- and a live subscription can start one at any moment. So a
 * draw() begun for the Data tab can still be in flight when the hash moves to
 * Catalogue, and it then writes ITS html into the same host, after the new
 * tab has already rendered: the URL says one tab and the page shows another.
 *
 * Measured, not hypothetical -- clearing the overlay and navigating in the
 * same breath reproduces it every time, because the clear fans out to the
 * subscription and the navigation lands mid-await.
 *
 * router.onLeave() cannot help: it unsubscribes, but a draw() already past
 * its await is not listening to anything any more. So each entry takes a
 * number and a stale draw drops its own result instead of painting it.
 */
let generation = 0;

router.registerScreen('admin', async (host, r) => {
  const tab = TABS.some((t) => t.id === r.params.tab) ? r.params.tab : 'overview';
  const mine = (generation += 1);

  const draw = async () => {
    const [orders, all, shop, cats, ov, state] = await Promise.all([
      store.orders.mine(), store.catalog.all(), store.catalog.shop(),
      store.catalog.categories(), store.catalog.overlay(),
      store.catalog.overlayState(),
    ]);
    if (mine !== generation) return;   // a newer entry owns the host now
    const ctx = { orders, all, shop, cats, ov, state, query: r.query || {} };

    let body;
    if (tab === 'orders') body = renderOrders(ctx);
    else if (tab === 'catalogue') body = renderCatalogue(ctx);
    else if (tab === 'inventory') body = renderInventory(ctx);
    else if (tab === 'categories') body = renderCategories(ctx);
    else if (tab === 'data') body = await renderData(ctx);
    else body = renderOverview(ctx);

    // renderData awaits again (the export encode and the canonical check), so
    // the guard is re-tested here rather than only above.
    if (mine !== generation) return;

    host.innerHTML = `
      ${h1('Admin', 'Owner', 'Catalogue, inventory and order management.')}
      ${tabBar(tab)}
      ${overlayStrip(state, O.countEdits(ov))}
      <div class="adm-body">${body}</div>
      <div style="margin-top:var(--s7)">${ornament()}</div>`;

    if (tab === 'orders') wireOrders(host, draw);
    else wireCatalogTab(tab, host, ctx, draw);
  };

  await draw();

  // Contract rule 4: subscribe returns the unsubscribe, and a screen that
  // forgets it fires N times after N visits.
  const offCat = store.live.subscribe('catalog', draw);
  const offOrd = store.live.subscribe('orders', draw);
  router.onLeave(() => { offCat(); offOrd(); });
});
