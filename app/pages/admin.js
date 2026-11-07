// ============================================================================
// The STORE page's screen — the overview, the orders board, and the tab bar
// over the catalogue editor. Imported by owner.js for owner.html, the store's
// own page; the shop never imports this module, and routes.pl fails if it does.
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
import { esc, h1, notice, toast, askFirst, $$ } from '../ui.js';
import { ornament } from '../brand.js';
import * as D from '../domain.js';
import * as O from '../overlay.js';
import { icon } from '../icons.js';
import { stars } from '../components.js';
import { renderCatalogue, renderInventory, renderCategories, renderData, wireCatalogTab }
  from './admin-catalog.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'categories', label: 'Categories' },
  { id: 'data', label: 'Data' },
];

const tabHref = (id, q) => `#/${id}${q ? '?' + q : ''}`;

function tabBar(active) {
  return `<nav class="adm-tabs" aria-label="Store sections">
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
  const late = orders.filter((o) => D.isLate(o));

  return `
  ${store.shared()
    ? notice('info', '<b>Every order, from every phone.</b> They arrive here the '
      + 'moment a customer places one, and this page updates by itself.')
    : notice('warn', '<b>These are orders placed in THIS browser only.</b> '
      + 'There is no server, so an order a customer places on their own phone '
      + 'never appears here — it reaches you on WhatsApp. Two tabs side by side '
      + 'make this look like it works, which is exactly why it is worth saying.')}

  <!-- Two groups, each named: the counts of ORDERS, and the counts of the
       CATALOGUE. As one row of six, "3 Products" beside "1 Open order" read
       as three products ordered (the owner, 7 November 2026). -->
  <h2 class="t-h3 adm-sec">Your orders</h2>
  <div class="adm-stats">
    ${stat('Open orders', open.length, 'Placed and not yet delivered', tabHref('orders'))}
    ${stat('Payment to check', unpaid.length, 'Not yet marked received', tabHref('orders'))}
    <!-- "What is 0 late? Late for what?" (the owner, 8 November 2026). Every
         order is promised a delivery window at checkout, "Arrives 10–16
         November"; this counts the open ones whose last day has passed. -->
    ${stat('Running late', late.length, late.length
      ? 'Past the delivery date promised to the customer'
      : 'None past the delivery date promised to the customer', tabHref('orders'))}
  </div>

  <h2 class="t-h3 adm-sec">Your catalogue</h2>
  <div class="adm-stats">
    ${stat('Products in the shop', all.length, 'Styles customers can buy', tabHref('catalogue'))}
    ${stat('Categories', cats.length, cats.map((c) => c.name).join(', '), tabHref('categories'))}
    ${stat('Low or out of stock', lowStock.length, `${shop.lowStockAt} or fewer left`, tabHref('inventory'))}
    ${stat('On offer', all.filter((p) => p.mrp > p.price).length, 'Priced below MRP', tabHref('catalogue'))}
  </div>

  <!-- One panel across the page. "Where the data lives" sat beside it, a
       note about catalog.json and patch sets for whoever builds the site;
       the owner, 8 November 2026: "not needed". The Data tab still says
       it, where exporting happens. -->
  <section class="panel" style="margin-top:var(--s6)">
      <h2 class="t-h3">Needs attention</h2>
      ${late.length || lowStock.length || unpaid.length ? `
      <div class="totals" style="margin-top:var(--s4)">
        ${late.map((o) => `<div class="total-row muted">
          <span><a href="${tabHref('orders')}">${esc(o.code)}</a> —
            late, promised by ${esc(D.fmtDate(o.arrives.to))}</span>
          <span>${esc(D.STATUS_LABEL[o.status])}</span></div>`).join('')}
        ${unpaid.map((o) => `<div class="total-row muted">
          <span><a href="${tabHref('orders')}">${esc(o.code)}</a> —
            payment not yet received (${esc(D.PAY_LABEL[o.payMethod] || o.payMethod)})</span>
          <span>${D.rupees(o.grand)}</span></div>`).join('')}
        ${lowStock.map((p) => `<div class="total-row muted">
          <span><a href="${tabHref('catalogue', 'p=' + encodeURIComponent(p.id))}">${esc(p.name)}</a></span>
          <span>${p.stock === 0 ? 'out of stock' : 'only ' + p.stock + ' left in stock'}</span></div>`).join('')}
      </div>` : `<p class="t-micro dim" style="margin-top:var(--s3)">
        Nothing is late, nothing is low on stock and no order is waiting on a payment check.</p>`}
  </section>`;
}

/** A count, what it counts, and one line saying what is in it. */
const stat = (label, n, sub, href) => `<a class="adm-stat" href="${href}">
  <span class="adm-stat-n">${n}</span>
  <span class="adm-stat-l">${esc(label)}</span>
  ${sub ? `<span class="adm-stat-s">${esc(sub)}</span>` : ''}</a>`;

// ---------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------
function renderOrders({ orders, shop, all }) {
  if (!orders.length && store.shared()) {
    return `<section class="panel">
      <h2 class="t-h3">No orders yet</h2>
      <p class="t-micro dim" style="margin-top:var(--s3);max-width:60ch">
        They appear here the moment a customer places one, on any phone. The
        board is not seeded with invented orders, because a board that invents
        orders cannot be trusted about the real ones.</p>
    </section>`;
  }
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
  return `<div class="adm-orders">${orders.map((o) => orderPanel(o, shop, all)).join('')}</div>`;
}

// A step's name on the board. History records what happened, so a saved
// order reads "Saved", not the status label "Not sent yet"; online, "sent" is
// an order placed, and a shop closing one before confirming is cancelling it.
const stepName = (o, s) => {
  if (s === 'draft') return 'Saved';
  if (o.sentVia === 'online' && s === 'sent') return 'Order placed';
  if (o.sentVia === 'online' && s === 'abandoned') return 'Cancelled';
  return D.STATUS_LABEL[s];
};

/** The order's status, as its pill says it: a new online order is NEW, and
 *  waits for Confirm. */
const pillName = (o) => (o.sentVia === 'online' && o.status === 'sent'
  ? 'New order' : stepName(o, o.status));

/** Can this backend take an order back a step? One browser can; a database
 *  can once schema.sql carries step_back_order() -- until then the server
 *  refuses, and the board says what to run (whyNot, below). */
const canBack = () => typeof store.orders.stepBack === 'function';

/**
 * THE STATUS LIST -- the whole road, top to bottom. Steps done are green, with
 * when; the one the order is at says Now.
 *
 * Every step AHEAD is a button that marks it and every step above it not done
 * yet: "Packed" on a new order is Confirm, then Pack, each written into the
 * order's history in turn (D.roadTo), so the customer's timeline shows every
 * step green too and the server's road -- the next step only -- is never asked
 * to skip one. Every step BEHIND is a button as well, since 8 November 2026:
 * it takes the order back there, after a wrong tap. Either way a pop-up says
 * what is about to happen (askFirst); the second tap is gone, on the owner's
 * word.
 */
function statusList(o) {
  const ended = D.ORDER_ENDS.includes(o.status);
  const path = D.ORDER_PATH.filter((st) => st !== 'draft' || D.statusAt(o, 'draft')
    || o.status === 'draft');
  const reach = path.indexOf(D.roadAt(o));
  const cur = path.indexOf(o.status);
  const s = o.shipment;
  const ship = s && (s.courier || s.ref)
    ? `${s.courier || 'courier not named'}${s.ref ? ', tracking number ' + s.ref : ''}` : '';
  const rows = [];
  for (let i = 0; i < path.length; i += 1) {
    const st = path[i];
    // Done means at or before where the order is -- not "has a date": an
    // order stepped back from Shipped still has Shipped in its history.
    const done = i <= reach;
    // An order that left the road stops where it left it.
    if (ended && !done) break;
    const at = done ? D.statusAt(o, st) : null;
    let state;
    let right = '';
    let label = esc(stepName(o, st));
    if (done) {
      state = !ended && i === cur && st !== 'delivered' ? 'now' : 'done';
      right = at ? `<span class="track-at">${esc(D.fmtStamp(at))}</span>` : '';
      if (!ended && i < cur && canBack() && D.canStepBack(o.status, st)) {
        label = `<button type="button" class="adm-back" data-back="${esc(st)}"
          title="Move the order back to ${esc(stepName(o, st))}">${label}</button>`;
      }
    } else {
      state = 'todo';
      const steps = D.roadTo(o.status, st);
      right = steps.length ? `<button type="button" class="btn btn-sm ${i === cur + 1
        ? 'btn-primary' : 'btn-secondary'}" data-goto="${esc(st)}">${esc(D.ACTION_LABEL[st])}</button>` : '';
    }
    rows.push(`<li class="is-${state}">
      <div class="adm-step">
        <span class="track-l">${label}${state === 'now'
          ? ' <span class="track-tag">Now</span>' : ''}</span>
        ${right}
      </div>
      ${st === 'shipped' && done && ship ? `<span class="track-at">${esc(ship)}</span>` : ''}
    </li>`);
  }
  if (ended) {
    rows.push(`<li class="is-end"><div class="adm-step">
      <span class="track-l">${esc(stepName(o, o.status))}</span>
      <span class="track-at">${esc(D.fmtStamp(D.statusAt(o, o.status)))}</span></div></li>`);
  }
  return `<ol class="track adm-track">${rows.join('')}</ol>`;
}

/** One step back, in words -- the likeliest correction, so it is a button of
 *  its own as well as a tap on the step. Then leaving the road: cancelling
 *  before it ships, a return after. Both final, and the pop-up says so. An
 *  order with an item already shipped on its own cannot be cancelled whole --
 *  that item is the courier's -- so the others are cancelled one by one. */
function endActions(o) {
  const acts = [];
  const prev = D.LINE_ROAD[D.LINE_ROAD.indexOf(o.status) - 1];
  if (prev && canBack() && D.canStepBack(o.status, prev)) {
    acts.push(`<button type="button" class="btn btn-sm btn-secondary" data-back="${esc(prev)}">
      ${icon('undo', 14)} Back to ${esc(stepName(o, prev))}</button>`);
  }
  const shipped = D.hasItemStatus(o)
    && o.lines.some((l) => ['shipped', 'delivered', 'returned'].includes(l.status));
  if (['sent', 'confirmed', 'packed'].includes(o.status) && !shipped) {
    acts.push('<button type="button" class="btn btn-sm btn-ghost adm-end-bad" data-end="cancelled">Cancel order</button>');
  }
  if (['sent', 'confirmed', 'packed'].includes(o.status) && shipped) {
    acts.push(`<span class="t-micro dim">An item has shipped, so the order cannot be
      cancelled whole: cancel the others one by one, above.</span>`);
  }
  if (o.status === 'draft') {
    acts.push(`<button type="button" class="btn btn-sm btn-ghost" data-end="abandoned">
      ${esc(D.ACTION_LABEL.abandoned)}</button>`);
  }
  if (['shipped', 'delivered'].includes(o.status)) {
    acts.push(`<button type="button" class="btn btn-sm btn-ghost" data-end="returned">
      ${esc(D.ACTION_LABEL.returned)}</button>`);
  }
  if (!acts.length) {
    return '<p class="t-micro dim adm-ends">This order is finished — no further step.</p>';
  }
  return `<div class="adm-ends">${acts.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// EACH ITEM (7 November 2026). Its status, a menu of the steps ahead, and
// Cancel item -- once the database carries a status per item
// (D.hasItemStatus) and this backend can move one. Until schema.sql has been
// re-run the items are a plain list, as before, and nothing here is offered.
// ---------------------------------------------------------------------------
const ITEM_LABEL = {
  sent: 'Ordered', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped',
  delivered: 'Delivered', returned: 'Returned', cancelled: 'Cancelled',
};
const perItem = (o) => D.hasItemStatus(o) && typeof store.orders.advanceLine === 'function';
const canBackLine = () => typeof store.orders.stepBackLine === 'function';

/**
 * One item: its status, and ONE menu of everything that can happen to it --
 * the steps ahead, the steps back (8 November 2026), and ending it: Cancel
 * while it has not shipped, Returned once it has. The owner looked for Cancel
 * in that menu and did not find it, so it is there now, and still a button
 * beside it too. Whatever is chosen, a pop-up says what happens first.
 */
function itemRow(o, l) {
  const on = perItem(o);
  const gone = on && l.status === 'cancelled';
  const ahead = on ? D.LINE_ROAD.filter((s) => D.lineRoadTo(l.status, s).length) : [];
  const behind = on && canBackLine() ? D.LINE_ROAD.filter((s) => D.canStepBack(l.status, s)) : [];
  const cancel = on && (D.LINE_NEXT[l.status] || []).includes('cancelled');
  const ret = on && (D.LINE_NEXT[l.status] || []).includes('returned');
  const sh = l.shipment && (l.shipment.courier || l.shipment.ref)
    ? `Shipped with ${l.shipment.courier || 'the courier'}${l.shipment.ref
      ? ', tracking number ' + l.shipment.ref : ''}` : '';
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const menu = ahead.length || behind.length || cancel || ret ? `<select class="adm-item-move"
      data-line-move aria-label="Change ${esc(l.name)}">
      <option value="">Move this item to…</option>
      ${ahead.length ? `<optgroup label="Move on">${ahead.map((s) => opt('go:' + s, ITEM_LABEL[s])).join('')}</optgroup>` : ''}
      ${behind.length ? `<optgroup label="Move back">${behind.slice().reverse()
        .map((s) => opt('back:' + s, 'Back to ' + ITEM_LABEL[s])).join('')}</optgroup>` : ''}
      ${cancel || ret ? `<optgroup label="End it">${cancel ? opt('end:cancelled', 'Cancel this item') : ''}${ret
        ? opt('end:returned', 'Returned') : ''}</optgroup>` : ''}
    </select>` : '';
  return `<div class="adm-item${gone ? ' is-cancelled' : ''}" data-line="${esc(String(l.id))}"
      data-lstatus="${esc(l.status || '')}" data-lname="${esc(l.name)}"
      data-ltotal="${esc(String(l.lineTotal))}">
    <div class="adm-item-top">
      <span class="adm-item-name">${esc(l.name)}${l.variantLabel ? ' · ' + esc(l.variantLabel) : ''}
        × ${l.qty}</span>
      <span class="adm-item-sum">${D.rupees(l.lineTotal)}</span>
    </div>
    ${on ? `<div class="adm-item-ctl">
      <span class="pill pill-${D.STATUS_TONE[l.status] || 'draft'}">${esc(ITEM_LABEL[l.status] || l.status)}</span>
      ${menu}
      ${cancel ? '<button type="button" class="btn btn-sm btn-secondary adm-item-cancel" data-line-cancel>Cancel item</button>' : ''}
    </div>` : ''}
    ${sh ? `<div class="t-micro dim">${esc(sh)}</div>` : ''}
  </div>`;
}

/** Money owed back after a cancellation, and the button that notes it sent. */
function refundBlock(o) {
  const due = D.refundDue(o);
  const owed = ['cancelled', 'abandoned'].includes(o.status) ? 0 : o.grand;
  return `${due > 0 ? `<div class="adm-refund">${notice('warn',
      `<b>Refund ${D.rupees(due)} to the customer.</b> They paid ${D.rupees(o.paidAmount)}
       and the order now comes to ${D.rupees(owed)}. Send it back from your UPI app, then
       mark it here.`)}
      <button type="button" class="btn btn-sm btn-secondary" data-refund>Mark refund sent</button>
    </div>` : ''}
    ${o.refunded ? `<p class="t-micro dim adm-refunded">${D.rupees(o.refunded)} refunded
      ${o.refundedAt ? 'on ' + esc(D.fmtStamp(o.refundedAt)) : ''}.</p>` : ''}`;
}

/** What the payment is, and what to check before saying it arrived. */
function payWhy(o) {
  if (o.paid) {
    return `Payment received — marked ${esc(D.fmtStamp(o.paidAt))}${o.paidVia
      ? ' · ' + esc(o.paidVia) : ''}. Only you can set this, and only you can undo it.`;
  }
  if (o.payMethod === 'upi') {
    return `<b>The customer chose UPI (QR).</b> Check your bank or UPI app for
      <b>${D.rupees(o.grand)}</b> with the note <b>${esc(o.code)}</b>, and mark it received
      once you see it. They have been asked to show their payment screenshot to the
      delivery partner too.`;
  }
  return `<b>${esc(D.PAY_LABEL.cod)}.</b> The delivery partner collects
    <b>${D.rupees(o.grand)}</b>, in cash or by UPI. Mark it received once that money
    reaches you.`;
}

/**
 * One order: what is in it, where it goes, who to call, what has happened,
 * and the next step. Everything the owner needs to put it in a parcel, on
 * one panel -- before this, the board showed the name and the total and
 * left the address on the customer's own page.
 */
function orderPanel(o, shop, all) {
  const c = o.customer || {};
  const tel = D.telTo(c.mobile);

  // The code opens the order IN THE SHOP (./#/order/...), as the customer
  // sees it. The store page has no order screen of its own.
  return `<section class="panel adm-order" data-oid="${esc(o.id)}" data-status="${esc(o.status)}">
    <header class="adm-order-head">
      <div>
        <a href="./#/order/${esc(o.code)}" class="ord-code">${esc(o.code)}</a>
        <span class="pill pill-${D.STATUS_TONE[o.status]}">${esc(pillName(o))}</span>
        ${D.isLate(o) ? '<span class="pill pill-bad">Late</span>' : ''}
        ${o.paid ? '<span class="pill pill-good">Payment received</span>'
          : '<span class="pill pill-draft">Payment pending</span>'}
      </div>
      <div class="ord-meta">${D.fmtStamp(o.createdAt)} ·
        ${o.lines.length} line${o.lines.length === 1 ? '' : 's'} ·
        <b>${D.rupees(o.grand)}</b>${D.placedGrand(o) !== o.grand
          && !['cancelled', 'abandoned'].includes(o.status)
          ? ` <span class="adm-was">(was ${D.rupees(D.placedGrand(o))})</span>` : ''}
        · ${esc(D.PAY_LABEL[o.payMethod] || o.payMethod)}</div>
      ${o.arrives ? `<div class="ord-meta">Promised
        ${esc(D.fmtDateRange(o.arrives.from, o.arrives.to))}${o.deliveredAt
          ? ' · delivered ' + esc(D.fmtDate(o.deliveredAt)) : ''}</div>` : ''}
    </header>

    ${o.gatewayRef ? notice('warn', `<b>A gateway reported a payment
      (${esc(o.gatewayRef.paymentId)}).</b> It is recorded as
      <b>unverified</b> and does not mark this order paid. Verifying it needs
      an HMAC over the key secret on a server, which does not exist yet — so
      check the bank yourself before marking it paid.`) : ''}

    ${priceNotice(o, shop, all)}

    <div class="adm-order-lines">
      ${perItem(o) ? `<div class="t-eyebrow adm-label">Items
        <span class="adm-hint">— move one on or back, or cancel it, on its own</span></div>` : ''}
      ${o.lines.map((l) => itemRow(o, l)).join('')}
    </div>

    <div class="adm-shipto">
      <div>
        <div class="t-eyebrow">Ship to</div>
        <p class="user-text">${esc(c.name || 'No name given')}<br>${esc(c.addr || '')}<br>
          ${esc([c.city, c.state].filter(Boolean).join(', '))} ${esc(c.pin || '')}</p>
      </div>
      <div>
        <div class="t-eyebrow">Contact</div>
        <p>${tel ? `<a href="${esc(tel)}">${esc(c.mobile)}</a>` : esc(c.mobile || 'No number')}${c.email
          ? `<br><a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}</p>
      </div>
    </div>

    <div class="adm-block">
      <div class="t-eyebrow adm-label">Status
        <span class="adm-hint">— tap a step to move the order there, forward or back</span></div>
      ${statusList(o)}
      ${endActions(o)}
    </div>

    <div class="adm-block">
      <div class="t-eyebrow adm-label">Payment</div>
      <p class="adm-paid-why">${payWhy(o)}</p>
      ${refundBlock(o)}
      <button type="button" class="btn btn-sm ${o.paid ? 'btn-ghost' : 'btn-primary'}"
        data-paid="${o.paid ? '0' : '1'}" data-method="${esc(o.payMethod)}">
        ${o.paid ? 'Undo payment received' : 'Mark payment received'}</button>
    </div>
  </section>`;
}

/**
 * ⚠️ THE SERVER RE-ADDS AN ORDER'S TOTALS BUT CANNOT KNOW ITS PRICES -- the
 * catalogue is JSON in git, not in the database -- so a forged request could
 * name its own. This page has the catalogue, so it checks every order against
 * today's prices and coupons, and says so before anybody puts it in a parcel.
 * A price changed since the order looks the same, which is why it says
 * "today's".
 */
function priceNotice(o, shop, all) {
  const off = D.checkOrderPrices(o, (id) => (all || []).find((p) => p.id === id), shop);
  if (!off.length) return '';
  return notice('bad', `<b>These are not today's catalogue prices.</b>
    ${off.map((x) => esc(x)).join('; ')}. Check them before you ship: an order
    can be made by hand to name its own price.`);
}

// ---------------------------------------------------------------------------
// REVIEWS (8 November 2026). What customers said once their orders were
// delivered: the delivery, with the courier it went by, and each product.
// A product's reviews are on its page in the shop; Hide takes one out of the
// shop (and out of its average) -- the words stay here, and Show puts it
// back. Nothing is ever edited or deleted from this side.
// ---------------------------------------------------------------------------
function renderReviews({ rv, orders, all }) {
  if (!store.reviews) {
    return `<section class="panel"><h2 class="t-h3">Reviews need the database</h2>
      <p class="t-micro dim" style="margin-top:var(--s3)">In one browser there is nobody
        to send a review to, so customers are never asked for one.</p></section>`;
  }
  if (!rv || rv.error) {
    return notice('warn', '<b>Reviews are not switched on in the database yet.</b> Run '
      + '<code>db/schema.sql</code> again (db/SETUP.md, step 10), and this tab fills itself.');
  }
  const { deliveries, products } = rv;
  if (!deliveries.length && !products.length) {
    return `<section class="panel"><h2 class="t-h3">No ratings yet</h2>
      <p class="t-micro dim" style="margin-top:var(--s3);max-width:60ch">Once you mark an
        item delivered, its customer can rate the delivery and the product, out of five,
        with a few words if they like. Each one appears here, and a product's reviews on
        its page in the shop.</p></section>`;
  }
  const code = (oid) => (orders.find((o) => o.id === oid) || {}).code || '';
  const avg = (xs) => (xs.length ? xs.reduce((n, x) => n + x.rating, 0) / xs.length : 0);
  const summary = (xs, what) => (xs.length
    ? `<span class="adm-rv-avg">${stars(avg(xs), 15)}<b>${avg(xs).toFixed(1)}</b>
        <span class="dim">from ${xs.length} ${xs.length === 1 ? what : what + 's'}</span></span>`
    : '<span class="dim">None on show</span>');
  const when = (at) => esc(D.fmtDate(at));
  const orderLink = (oid) => (code(oid)
    ? `<a class="ord-code" href="./#/order/${esc(code(oid))}">${esc(code(oid))}</a>` : '');

  const deliveryPanel = `<section class="panel">
    <div class="adm-rv-head"><h2 class="t-h3">The delivery</h2>${summary(deliveries, 'rating')}</div>
    ${deliveries.length ? `<div class="adm-rv-list">${deliveries.map((d) => `<div class="adm-rv">
        <div class="adm-rv-top">${stars(d.rating, 14)} ${orderLink(d.orderId)}
          <span class="dim">· ${esc(d.courier || 'courier not named')} · ${when(d.at)}</span></div>
        ${d.comment ? `<p class="adm-rv-text user-text">${esc(d.comment)}</p>` : ''}
      </div>`).join('')}</div>`
      : '<p class="t-micro dim" style="margin-top:var(--s3)">No delivery rated yet.</p>'}
  </section>`;

  // Products in catalogue order, each with its average over the reviews on show.
  const pids = [...new Set(products.map((x) => x.pid))]
    .sort((a, b) => all.findIndex((p) => p.id === a) - all.findIndex((p) => p.id === b));
  const productPanel = `<section class="panel" style="margin-top:var(--s4)">
    <h2 class="t-h3">The products</h2>
    ${pids.length ? pids.map((pid) => {
      const p = all.find((x) => x.id === pid);
      const mine = products.filter((x) => x.pid === pid);
      const shown = mine.filter((x) => !x.hidden);
      return `<div class="adm-rv-prod">
        <div class="adm-rv-head">${p ? `<a class="adm-rv-name" href="./#/p/${esc(p.slug)}">${esc(p.name)}</a>`
          : `<span class="adm-rv-name">${esc(pid)}</span>`}${summary(shown, 'review')}</div>
        <div class="adm-rv-list">${mine.map((x) => `<div class="adm-rv${x.hidden ? ' is-hidden' : ''}">
          <div class="adm-rv-top">${stars(x.rating, 14)} <b>${esc(x.author)}</b> ${orderLink(x.orderId)}
            <span class="dim">· ${when(x.at)}</span>
            ${x.hidden ? '<span class="pill pill-draft">Hidden from the shop</span>' : ''}</div>
          ${x.comment ? `<p class="adm-rv-text user-text">${esc(x.comment)}</p>` : ''}
          <button type="button" class="btn-ghost" data-rv-hide="${esc(String(x.id))}"
            data-to="${x.hidden ? '0' : '1'}">${x.hidden ? 'Show it in the shop again'
              : 'Hide from the shop'}</button>
        </div>`).join('')}</div>
      </div>`;
    }).join('') : '<p class="t-micro dim" style="margin-top:var(--s3)">No product reviewed yet.</p>'}
  </section>`;

  return deliveryPanel + productPanel;
}

function wireReviews(host) {
  for (const btn of $$('[data-rv-hide]', host)) {
    btn.addEventListener('click', async () => {
      const hide = btn.dataset.to === '1';
      btn.disabled = true;
      try {
        await store.reviews.hide(Number(btn.dataset.rvHide), hide);
        toast(hide ? 'Hidden from the shop. It is still here.' : 'Back on the shop.');
      } catch (e) {
        btn.disabled = false;
        toast(String(e.message || e));
      }
    });
  }
}

/** Courier and tracking number, asked for in the pop-up of any step that
 *  passes through Shipped. Both optional: who ships is still not settled. */
const shipFields = () => `
  <div class="field"><label for="ask-courier">Courier <span class="opt">(optional)</span></label>
    <input id="ask-courier" name="courier" maxlength="60" autocomplete="off"
      placeholder="Delhivery, India Post…"></div>
  <div class="field"><label for="ask-ref">Tracking number <span class="opt">(optional)</span></label>
    <input id="ask-ref" name="ref" maxlength="60" autocomplete="off"></div>`;

/** "Confirmed and Packed" -- steps named the way the board names them. */
const andList = (xs) => (xs.length < 2 ? xs.join('')
  : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** What a refused step means, in words. A database whose schema.sql has not
 *  been re-run since 8 November 2026 has no step_back_* functions yet. */
function whyNot(e) {
  const m = String((e && e.message) || e);
  if (/step_back_|Could not find the function|schema cache/i.test(m)) {
    return 'Going back needs the latest database update: run db/schema.sql again '
      + '(db/SETUP.md, step 9).';
  }
  if (/BAD_STEP_BACK/.test(m)) return 'That step cannot be taken back.';
  if (/SOME_ITEMS_SHIPPED/.test(m)) return 'An item has shipped, so cancel the others one by one.';
  if (/NOT_STAFF/.test(m)) return 'This phone is not let into the store any more. Reload and type the store code.';
  return m;
}

/** Status changes and the one human-asserted field in the project. Every one
 *  asks first, in a pop-up that says what will happen (askFirst). */
function wireOrders(host, repaint, orders = []) {
  const panel = (el) => el.closest('[data-oid]');
  const codeOf = (box) => box.querySelector('.ord-code').textContent;
  // The orders this board was drawn from: what a pop-up says is what the
  // owner is looking at, with no read in between.
  const orderOf = (box) => orders.find((o) => o.id === box.dataset.oid);

  // A step AHEAD, and every step above it not done yet.
  for (const btn of $$('[data-goto]', host)) {
    btn.addEventListener('click', async () => {
      const box = panel(btn);
      const to = btn.dataset.goto;
      const steps = D.roadTo(box.dataset.status, to);
      if (!steps.length) return;
      const o = orderOf(box) || { sentVia: 'online' };
      const name = (s) => stepName(o, s);
      const got = await askFirst({
        title: `Mark ${codeOf(box)} as ${D.STATUS_LABEL[to].toLowerCase()}?`,
        body: (steps.length > 1
          ? `<p>This also marks <b>${esc(andList(steps.slice(0, -1).map(name)))}</b> as done.
             The customer sees every step up to ${esc(name(to))} in green.</p>`
          : `<p>The customer sees it on their order page straight away.</p>`)
          + '<p>If this is a mistake, you can move it back afterwards.</p>',
        more: steps.includes('shipped') ? shipFields() : '',
        yes: D.ACTION_LABEL[to],
      });
      if (!got) return;
      try {
        for (const s of steps) {
          if (s === 'shipped') await store.orders.ship(box.dataset.oid, { courier: got.courier, ref: got.ref });
          else await store.orders.advance(box.dataset.oid, s);
        }
        toast(`${codeOf(box)} is now ${D.STATUS_LABEL[to].toLowerCase()}.`);
      } catch (e) {
        // ⚠️ Shown, never swallowed. Steps already taken stay taken, and the
        // board redraws to show exactly where the order got to.
        toast(whyNot(e));
      }
      repaint();
    });
  }

  // A step BEHIND: the order goes back there (8 November 2026).
  for (const btn of $$('[data-back]', host)) {
    btn.addEventListener('click', async () => {
      const box = panel(btn);
      const to = btn.dataset.back;
      const from = box.dataset.status;
      if (!D.canStepBack(from, to)) return;
      const o = orderOf(box) || { sentVia: 'online', lines: [] };
      const name = (s) => stepName(o, s);
      const undone = D.LINE_ROAD.slice(D.LINE_ROAD.indexOf(to) + 1, D.LINE_ROAD.indexOf(from) + 1);
      const ahead = D.hasItemStatus(o) && o.lines.some((l) =>
        D.LINE_ROAD.indexOf(l.status) > D.LINE_ROAD.indexOf(from));
      const got = await askFirst({
        title: `Move ${codeOf(box)} back to ${name(to)}?`,
        body: `<p><b>${esc(andList(undone.map(name)))}</b> will be taken off, and the customer
            will see ${esc(name(to))} as the latest step.</p>`
          + (from === 'delivered' ? '<p>The delivery date goes too, so the return window starts '
            + 'again when you next mark it delivered.</p>' : '')
          + (D.LINE_ROAD.indexOf(from) >= D.LINE_ROAD.indexOf('shipped')
             && D.LINE_ROAD.indexOf(to) < D.LINE_ROAD.indexOf('shipped')
            ? '<p>The courier and tracking number are cleared.</p>' : '')
          + (ahead ? '<p>An item you moved further on its own stays where it is.</p>' : '')
          + '<p>You can mark the steps again whenever you are ready.</p>',
        yes: 'Move back',
      });
      if (!got) return;
      try {
        await store.orders.stepBack(box.dataset.oid, to);
        toast(`${codeOf(box)} is back to ${name(to).toLowerCase()}.`);
      } catch (e) {
        toast(whyNot(e));
      }
      repaint();
    });
  }

  // Leaving the road. Final -- nothing follows a cancellation -- and said so.
  for (const btn of $$('[data-end]', host)) {
    btn.addEventListener('click', async () => {
      const box = panel(btn);
      const to = btn.dataset.end;
      const o = orderOf(box) || {};
      const code = codeOf(box);
      const final = '<p class="ask-final">This cannot be undone.</p>';
      const ask = to === 'returned' ? {
        title: `Mark ${code} as returned?`,
        body: '<p>Once the parcel has come back to you. The customer sees it as returned.</p>' + final,
        yes: 'Mark returned', no: 'Not now',
      } : to === 'abandoned' ? {
        title: `Close ${code}?`,
        body: '<p>It was saved in this browser and never sent to you. Closing it keeps it in '
          + 'the list as closed.</p>' + final,
        yes: D.ACTION_LABEL.abandoned, no: 'Keep it open',
      } : {
        title: `Cancel order ${code}?`,
        body: '<p>Every item is cancelled and nothing will be sent. The customer sees the order '
          + 'as cancelled.</p>'
          + (o.paid ? `<p>They have paid ${D.rupees(o.paidAmount || o.grand)}, so you will be shown `
            + 'the refund to send.</p>' : '')
          + final,
        yes: 'Cancel order', no: 'Keep the order',
      };
      if (!(await askFirst({ ...ask, danger: true }))) return;
      try {
        await store.orders.advance(box.dataset.oid, to);
        toast(to === 'returned' ? `${code} marked returned.` : to === 'abandoned'
          ? `${code} closed.` : `${code} cancelled.`);
      } catch (e) {
        toast(whyNot(e));
      }
      repaint();
    });
  }

  for (const btn of $$('[data-paid]', host)) {
    btn.addEventListener('click', async () => {
      const box = panel(btn);
      const to = btn.dataset.paid === '1';
      if (to) {
        const o = orderOf(box) || {};
        const got = await askFirst({
          title: `Mark ${D.rupees(o.grand || 0)} as received?`,
          body: (btn.dataset.method === 'cod'
            ? '<p>Only once the money the delivery partner collected for this order, in '
              + 'cash or by UPI, has reached you.</p>'
            : `<p>Only once you have seen <b>${D.rupees(o.grand || 0)}</b> with the note
               <b>${esc(codeOf(box))}</b> in your bank or UPI app.</p>`)
            + '<p>The customer sees the payment confirmed on their order page. You can undo it.</p>',
          yes: 'Yes, received',
        });
        if (!got) return;
      }
      await store.orders.setPaid(box.dataset.oid, to, to ? 'checked by hand' : null);
      toast(to ? 'Payment marked received.' : 'Payment no longer marked received.');
      repaint();
    });
  }

  // ONE ITEM: on, back, cancelled or returned -- one menu, one pop-up.
  const lineOf = (item) => ({
    oid: panel(item).dataset.oid, id: Number(item.dataset.line), status: item.dataset.lstatus,
    name: item.dataset.lname, total: Number(item.dataset.ltotal) || 0,
  });

  const moveOn = async (item, to) => {
    const l = lineOf(item);
    const steps = D.lineRoadTo(l.status, to);
    if (!steps.length) return;
    const got = await askFirst({
      title: `Mark ${l.name} as ${ITEM_LABEL[to].toLowerCase()}?`,
      body: (steps.length > 1
        ? `<p>This also marks it <b>${esc(andList(steps.slice(0, -1).map((s) => ITEM_LABEL[s])))}</b>.</p>` : '')
        + `<p>The order moves on once every item still on its way is ${esc(ITEM_LABEL[to].toLowerCase())}.</p>`,
      more: steps.includes('shipped') ? shipFields() : '',
      yes: `Mark ${ITEM_LABEL[to].toLowerCase()}`,
    });
    if (!got) return;
    try {
      for (const s of steps) {
        await store.orders.advanceLine(l.oid, l.id, s, { courier: got.courier || '', ref: got.ref || '' });
      }
      toast(`${l.name} is now ${ITEM_LABEL[to].toLowerCase()}.`);
    } catch (e) {
      toast(whyNot(e));
    }
  };

  const moveBack = async (item, to) => {
    const l = lineOf(item);
    if (!D.canStepBack(l.status, to)) return;
    const got = await askFirst({
      title: `Move ${l.name} back to ${ITEM_LABEL[to].toLowerCase()}?`,
      body: '<p>If it is now the slowest item, the order goes back with it, and the customer sees '
        + 'that step as the latest.</p>'
        + (D.LINE_ROAD.indexOf(to) < D.LINE_ROAD.indexOf('shipped')
           && D.LINE_ROAD.indexOf(l.status) >= D.LINE_ROAD.indexOf('shipped')
          ? '<p>Its courier and tracking number are cleared.</p>' : '')
        + '<p>You can move it on again later.</p>',
      yes: 'Move back',
    });
    if (!got) return;
    try {
      await store.orders.stepBackLine(l.oid, l.id, to);
      toast(`${l.name} is back to ${ITEM_LABEL[to].toLowerCase()}.`);
    } catch (e) {
      toast(whyNot(e));
    }
  };

  const endItem = async (item, to) => {
    const l = lineOf(item);
    const o = orders.find((x) => x.id === l.oid) || { lines: [] };
    const live = o.lines.filter((x) => x.status !== 'cancelled');
    const last = live.length === 1 && String(live[0].id) === String(l.id);
    const final = '<p class="ask-final">This cannot be undone.</p>';
    const ask = to === 'returned' ? {
      title: `Mark ${l.name} as returned?`,
      body: '<p>Once it has come back to you.</p>' + final,
      yes: 'Mark returned', no: 'Not now',
    } : {
      title: `Cancel ${l.name}?`,
      body: `<p>It comes off the order: the total drops by <b>${D.rupees(l.total)}</b>${o.discount
          ? ', and the coupon shrinks with it' : ''}.</p>`
        + (last ? '<p>It is the last item left, so the whole order is cancelled.</p>' : '')
        + (o.paid ? '<p>The customer has paid, so you will be shown the refund to send.</p>' : '')
        + final,
      yes: 'Cancel item', no: 'Keep it',
    };
    if (!(await askFirst({ ...ask, danger: true }))) return;
    try {
      await store.orders.advanceLine(l.oid, l.id, to);
      toast(to === 'returned' ? `${l.name} marked returned.` : `${l.name} cancelled.`);
    } catch (e) {
      toast(whyNot(e));
    }
  };

  for (const sel of $$('[data-line-move]', host)) {
    sel.addEventListener('change', async () => {
      const item = sel.closest('[data-line]');
      const [kind, to] = sel.value.split(':');
      sel.value = '';
      if (kind === 'go') await moveOn(item, to);
      else if (kind === 'back') await moveBack(item, to);
      else if (kind === 'end') await endItem(item, to);
      else return;
      repaint();
    });
  }

  for (const btn of $$('[data-line-cancel]', host)) {
    btn.addEventListener('click', async () => {
      await endItem(btn.closest('[data-line]'), 'cancelled');
      repaint();
    });
  }

  // A refund sent: a person's note, like the payment.
  for (const btn of $$('[data-refund]', host)) {
    btn.addEventListener('click', async () => {
      const box = panel(btn);
      const o = orderOf(box) || {};
      const got = await askFirst({
        title: `Mark the ${D.rupees(D.refundDue(o))} refund as sent?`,
        body: '<p>Only once you have sent it back from your UPI app. The customer sees when it went.</p>',
        yes: 'Yes, I sent it',
      });
      if (!got) return;
      try {
        const amount = await store.orders.markRefund(box.dataset.oid);
        toast(`Refund of ${D.rupees(amount)} noted.`);
      } catch (e) {
        toast(/NOTHING_TO_REFUND/.test(String(e.message || e))
          ? 'Nothing is owed back on this order.' : whyNot(e));
      }
      repaint();
    });
  }
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
      store.orders.all(), store.catalog.all(), store.catalog.shop(),
      store.catalog.categories(), store.catalog.overlay(),
      store.catalog.overlayState(),
    ]);
    if (mine !== generation) return;   // a newer entry owns the host now
    const ctx = { orders, all, shop, cats, ov, state, query: r.query || {} };
    // The reviews, on their own tab only: every other tab draws without them.
    if (tab === 'reviews' && store.reviews) {
      try { ctx.rv = await store.reviews.all(); } catch (e) { ctx.rv = { error: e }; }
      if (mine !== generation) return;
    }

    let body;
    if (tab === 'orders') body = renderOrders(ctx);
    else if (tab === 'reviews') body = renderReviews(ctx);
    else if (tab === 'catalogue') body = renderCatalogue(ctx);
    else if (tab === 'inventory') body = renderInventory(ctx);
    else if (tab === 'categories') body = renderCategories(ctx);
    else if (tab === 'data') body = await renderData(ctx);
    else body = renderOverview(ctx);

    // renderData awaits again (the export encode and the canonical check), so
    // the guard is re-tested here rather than only above.
    if (mine !== generation) return;

    host.innerHTML = `
      ${h1('Store', shop.brand.name, 'Orders, the catalogue and stock, for the people who run the shop.')}
      ${tabBar(tab)}
      ${overlayStrip(state, O.countEdits(ov))}
      <div class="adm-body">${body}</div>
      <div style="margin-top:var(--s7)">${ornament()}</div>`;

    if (tab === 'orders') wireOrders(host, draw, ctx.orders);
    else if (tab === 'reviews') wireReviews(host);
    else wireCatalogTab(tab, host, ctx, draw);
  };

  await draw();

  // Contract rule 4: subscribe returns the unsubscribe, and a screen that
  // forgets it fires N times after N visits.
  const offCat = store.live.subscribe('catalog', draw);
  const offOrd = store.live.subscribe('orders', draw);
  const offRev = store.live.subscribe('reviews', draw);
  router.onLeave(() => { offCat(); offOrd(); offRev(); });
});
