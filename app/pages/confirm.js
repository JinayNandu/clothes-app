// ============================================================================
// The customer's order page: what was ordered, where it is now, and how to
// pay. Reached straight after checkout, from "Your orders", and from the
// store's board, which opens it to see an order the way the customer does.
//
// ⚠️ IT NEVER SAYS "order confirmed", "order placed successfully", "thank you
// for your purchase" or "payment successful" -- not even after the store HAS
// confirmed, because honesty.pl cannot tell a true sentence from a false one
// and fails on all four wherever they appear. Each state says instead what
// happened, when, and who did it.
//
// draft -> sent is the customer's step: a handoff button below. Every later
// step is the store's, taken on the store page. Nothing advances on a timer.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, emptyState, notice, toast } from '../ui.js';
import { handoffBlock, wireHandoff } from '../handoff.js';
import { drawQR, demoStrip } from '../pay.js';
import { seal, ornament } from '../brand.js';
import * as D from '../domain.js';

/**
 * ⚠️ WHICH ENTRY OF THIS SCREEN IS CURRENT. The page follows its order live --
 * the store marking it packed in another tab redraws the timeline here -- and
 * every redraw awaits a read. One begun for an order this host has since
 * moved on from must drop its result, not paint it. Same guard as admin.js.
 */
let generation = 0;

router.registerScreen('confirm', async (host, r) => {
  const mine = (generation += 1);
  const [first, shop] = await Promise.all([
    store.orders.byCode(r.params.code), store.catalog.shop(),
  ]);
  if (mine !== generation) return;

  if (!first && store.shared()) {
    host.innerHTML = emptyState(seal(64), 'We cannot find that order here.',
      'An order opens only in the browser it was placed from: with no sign-in yet, '
      + 'another phone cannot tell it is yours. If this is that browser, check the '
      + 'code, or write to us with it.',
      'Contact us', '#/contact');
    return;
  }
  if (!first) {
    host.innerHTML = emptyState(seal(64), 'We cannot find that order.',
      'Orders are saved in the browser they were created in. If you placed this '
      + 'one on another device or cleared your browser data, it is not here — '
      + 'but if you sent it to us, we still have it.',
      'Contact us', '#/contact');
    return;
  }

  let order = first;
  host.innerHTML = page(order, shop);
  drawPay(host, order, shop);

  wireHandoff(host.querySelector('[data-handoff]'), async (via) => {
    if (order.status !== 'draft') return;
    try {
      await store.orders.markSent(order.id, via);
      toast('Marked as sent. We will reply to confirm.');
    } catch (e) {
      console.error(e);
    }
  });

  // ⚠️ PARTS, never the whole page. A full repaint would rebuild the handoff
  // block too -- and the Copy button's fallback, a visible textarea for when
  // the clipboard is refused, would vanish the instant that same tap marked
  // the order sent. So only what a change of status can change is redrawn.
  let payKey = keyOfPay(order);
  const refresh = async () => {
    const fresh = await store.orders.byCode(r.params.code);
    if (mine !== generation || !fresh) return;
    order = fresh;
    for (const [sel, html] of [
      ['[data-title]', title(order)],
      ['[data-arrive]', arriveLine(order, shop)],
      ['[data-status]', statusBlock(order, shop)],
      ['[data-track]', track(order)],
      ['[data-handoff-head]', handoffHead(order)],
    ]) {
      const el = host.querySelector(sel);
      if (el) el.innerHTML = html;
    }
    if (keyOfPay(order) !== payKey) {
      payKey = keyOfPay(order);
      drawPay(host, order, shop);
    }
  };
  router.onLeave(store.live.subscribe('orders', refresh));
});

// ---------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------
function page(o, shop) {
  return `
  <div style="max-width:720px;margin:0 auto">
    <div style="text-align:center;margin-bottom:var(--s5)">
      <span style="color:var(--gold)">${seal(56)}</span>
      <h1 class="t-h1" style="margin-top:var(--s3)" data-title>${title(o)}</h1>
      <p class="t-micro dim" style="margin-top:var(--s2)">
        Saved ${D.fmtStamp(o.createdAt)}</p>
      <p class="arrive" data-arrive>${arriveLine(o, shop)}</p>
    </div>

    <div data-status>${statusBlock(o, shop)}</div>

    <section class="panel" style="margin-top:var(--s5)">
      <h2 class="t-h3">Where it is</h2>
      <div data-track>${track(o)}</div>
    </section>

    <section class="panel" style="margin-top:var(--s4)">
      <div data-handoff-head>${handoffHead(o)}</div>
      <div data-handoff>${handoffBlock(D.orderSummaryText(o, shop), shop,
        { subject: 'Order ' + o.code })}</div>
    </section>

    <div data-pay></div>

    ${ordered(o)}

    <div style="margin-top:var(--s6)">${ornament()}</div>

    <div style="display:flex;gap:var(--s3);justify-content:center;margin-top:var(--s5);
                flex-wrap:wrap">
      <a class="btn btn-secondary" href="#/shop">Continue shopping</a>
      <a class="btn btn-secondary" href="#/account">Your orders</a>
    </div>
  </div>`;
}

const title = (o) =>
  `${o.status === 'draft' ? 'Order request saved' : 'Your order'} &mdash; ${esc(o.code)}`;

/**
 * The delivery promise, as this order stands.
 *
 * ⚠️ READ OFF THE ORDER, never worked out here -- see arrivalPromise(), and
 * honesty.pl, which fails if this file ever calls deliveryEstimate(). A
 * draft has not reached the shop, so it has no promise yet and gets the rule
 * in days. An order sent before promises were kept gets nothing, rather than
 * one invented now.
 */
function arriveLine(o, shop) {
  if (o.status === 'draft') {
    const dd = (shop.shipping && shop.shipping.deliveryDays) || {};
    return dd.min && dd.max
      ? `Arrives ${dd.min}–${dd.max} working days after you send it to us.` : '';
  }
  if (!o.arrives || !['sent', 'confirmed', 'packed', 'shipped'].includes(o.status)) return '';
  const range = esc(D.fmtDateRange(o.arrives.from, o.arrives.to));
  return o.status === 'sent'
    ? `Should arrive <b>${range}</b>, once we confirm it.`
    : `Arrives <b>${range}</b>`;
}

function handoffHead(o) {
  return o.status === 'draft'
    ? `<h2 class="t-h3">Send it to us</h2>
       <p class="t-micro dim" style="margin:var(--s2) 0 var(--s4)">
         Any one of these. The whole order travels with it &mdash; you do not
         need to type anything.</p>`
    : `<h2 class="t-h3">Write to us about it</h2>
       <p class="t-micro dim" style="margin:var(--s2) 0 var(--s4)">
         A question, or a change of size or address before it ships: the order
         travels with your message, so there is nothing to look up.</p>`;
}

// ---------------------------------------------------------------------------
// The status block. One state each, and none claims more than is true.
// ---------------------------------------------------------------------------
function statusBlock(o, shop) {
  const name = esc(shop.brand.name);
  const at = (s) => esc(D.fmtStamp(D.statusAt(o, s)));
  switch (o.status) {
    case 'draft':
      return notice('warn',
        `<b>${name} has not received this yet.</b> There is no `
      + 'server behind this website, so saving an order does not send it '
      + 'anywhere. It is a record in this browser, with a code, waiting for you '
      + 'to hand it over using one of the buttons below.');
    case 'sent': {
      if (o.sentVia === 'online') {
        return notice('good', `<b>Sent to us at ${esc(D.fmtStamp(o.sentAt))}.</b> `
          + 'We confirm every order by hand, and this page will show it the moment '
          + 'we have. Until then nothing is confirmed and nothing has been dispatched.');
      }
      const via = { whatsapp: 'on WhatsApp', phone: 'by phone',
                    email: 'by email', copy: 'by copying it' }[o.sentVia] || '';
      // ⚠️ "Sent", never "confirmed". Only a person at the shop can confirm,
      // and they do it on the store page, not here.
      return notice('good',
        `<b>Sent ${esc(via)} at ${esc(D.fmtStamp(o.sentAt || D.statusAt(o, 'sent')))}.</b> `
      + 'We will reply to confirm the order and the delivery date. Until somebody '
      + `at ${name} replies, nothing is confirmed and nothing has been dispatched.`);
    }
    case 'confirmed':
      return notice('good', `<b>${name} confirmed it on ${at('confirmed')}.</b> `
        + 'It is being made ready. Packing comes next, then the courier.');
    case 'packed':
      return notice('good', `<b>Packed on ${at('packed')}.</b> `
        + 'It goes to the courier next.');
    case 'shipped': {
      const ship = shipText(o);
      return notice('good', `<b>On its way since ${at('shipped')}.</b> `
        + (ship ? esc(ship) + '.' : 'With the courier.'));
    }
    case 'delivered':
      return notice('good', `<b>Delivered on ${at('delivered')}.</b> `
        + 'To return or exchange anything, write to us below.');
    case 'returned':
      return notice('info', `<b>Returned on ${at('returned')}.</b>`);
    case 'cancelled':
      return notice('bad', `<b>Cancelled on ${at('cancelled')}.</b> Nothing will be `
        + 'sent. If you had already paid, write to us below so we can return the money.');
    case 'abandoned':
      return notice('bad', `<b>Closed on ${at('abandoned')}, never sent to us.</b> `
        + 'Nothing was dispatched and nothing is owed.');
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// THE TIMELINE. Every date in it was written when that step was taken; see
// trackSteps() for why none is worked out.
// ---------------------------------------------------------------------------
function track(o) {
  const ship = shipText(o);
  return `<ol class="track">${D.trackSteps(o).map((s) => `
    <li class="is-${s.state}">
      <span class="track-l">${esc(D.TRACK_LABEL[s.status])}${s.state === 'now'
        ? ' <span class="track-tag">Now</span>' : ''}</span>
      <span class="track-at">${s.at ? esc(D.fmtStamp(s.at))
        : s.status === 'delivered' && o.arrives
          ? `Due ${esc(D.fmtDateRange(o.arrives.from, o.arrives.to))}` : 'Not yet'}</span>
      ${s.status === 'shipped' && s.at && ship
        ? `<span class="track-at">${esc(ship)}</span>` : ''}
    </li>`).join('')}</ol>`;
}

/** "With Delhivery, tracking number 1234" -- or nothing, if the store gave none. */
function shipText(o) {
  const s = o.shipment;
  if (!s || (!s.courier && !s.ref)) return '';
  return `With ${s.courier || 'the courier'}${s.ref ? `, tracking number ${s.ref}` : ''}`;
}

// ---------------------------------------------------------------------------
// PAYMENT. Redrawn only when what it says can change, because the UPI QR is
// drawn by a library into a real element.
// ---------------------------------------------------------------------------
const keyOfPay = (o) => [o.paid, ['cancelled', 'abandoned'].includes(o.status),
  o.status === 'draft'].join('|');

function drawPay(host, o, shop) {
  const box = host.querySelector('[data-pay]');
  if (!box) return;
  box.innerHTML = payPanel(o, shop);
  const qr = box.querySelector('[data-qr]');
  if (qr) drawQR(qr, shop, o);
}

function payPanel(o, shop) {
  if (o.paid) {
    return `<section class="panel" style="margin-top:var(--s4)">
      <h2 class="t-h3">Payment</h2>
      <div style="margin-top:var(--s3)">${notice('good',
        `<b>Paid, ${D.rupees(o.grand)}.</b> ${esc(shop.brand.name)} marked it `
      + `paid on ${esc(D.fmtStamp(o.paidAt))}, after checking for the money by hand.`)}</div>
    </section>`;
  }
  // Nothing to pay on an order that will never be sent.
  if (['cancelled', 'abandoned'].includes(o.status)) return '';

  if (o.payMethod === 'upi') {
    return `
      <section class="panel" style="margin-top:var(--s4)">
        <h2 class="t-h3">Paying by UPI</h2>
        ${demoStrip(shop.upi)}
        <div style="display:flex;gap:var(--s5);align-items:center;flex-wrap:wrap;
                    margin-top:var(--s4)">
          <div class="qr-tile" data-qr></div>
          <div style="flex:1;min-width:220px">
            <div class="total-row grand" style="border:0;padding:0">
              <span>Amount</span><span>${D.rupees(o.grand)}</span></div>
            <p class="t-micro dim" style="margin-top:var(--s3)">
              Scan with GPay, PhonePe, Paytm or your bank app. The amount and
              your order code travel in the QR, so there is nothing to type.</p>
            <p class="t-micro" style="margin-top:var(--s3);color:var(--ink-soft)">
              <b>Nothing here can see whether you paid.</b> UPI sends no message
              back to a web page. Please send us the payment screenshot along
              with the order, and we will check it against our own bank record.</p>
          </div>
        </div>
      </section>`;
  }
  return `
    <section class="panel" style="margin-top:var(--s4)">
      <h2 class="t-h3">Cash on delivery</h2>
      <p class="t-micro dim" style="margin-top:var(--s2)">
        Pay the courier ${D.rupees(o.grand)} when the parcel arrives.${o.status === 'draft'
          ? ' We will still need you to send the order through above, so a person '
            + 'here can confirm it and dispatch.' : ''}</p>
    </section>`;
}

// ---------------------------------------------------------------------------
// WHAT WAS ORDERED — as it was at the moment it was saved. Every number here
// is the order's own, never re-read from the catalogue, so a price changed
// tomorrow does not rewrite a receipt from today.
// ---------------------------------------------------------------------------
function ordered(o) {
  const c = o.customer || {};
  return `
    <section class="panel" style="margin-top:var(--s4)">
      <h2 class="t-h3">What you ordered</h2>
      <div class="totals" style="margin-top:var(--s4)">
        ${o.lines.map((l) => `
          <div class="total-row muted">
            <span>${l.qty} &times; ${esc(l.name)}${l.variantLabel
              ? `<br><span class="t-micro dim">${esc(l.variantLabel)}</span>` : ''}</span>
            <span>${D.rupees(l.lineTotal)}</span></div>`).join('')}
        <div class="total-row muted" style="border-top:1px solid var(--edge);padding-top:var(--s3)">
          <span>Items</span><span>${D.rupees(o.itemsTotal)}</span></div>
        ${o.discount ? `<div class="total-row save">
          <span>Coupon ${esc(o.coupon)}</span>
          <span>&minus;${D.rupees(o.discount)}</span></div>` : ''}
        <div class="total-row muted"><span>Shipping</span>
          <span>${o.shipping ? D.rupees(o.shipping) : 'Free'}</span></div>
        ${o.bulky ? `<div class="total-row muted">
          <span>Bulky item handling</span><span>${D.rupees(o.bulky)}</span></div>` : ''}
        <div class="total-row grand"><span>Total</span><span>${D.rupees(o.grand)}</span></div>
      </div>

      <div style="margin-top:var(--s5);padding-top:var(--s4);border-top:1px solid var(--edge)">
        <div class="t-eyebrow" style="color:var(--ink-soft);margin-bottom:var(--s2)">
          Delivering to</div>
        <p class="t-micro user-text" style="line-height:1.7">
          ${esc(c.name)}<br>
          ${esc(c.addr)}<br>
          ${esc(c.city)}, ${esc(c.state)} ${esc(c.pin)}<br>
          ${esc(c.mobile)}${c.email ? ' · ' + esc(c.email) : ''}
        </p>
        <p class="t-micro dim" style="margin-top:var(--s2)">
          Paying by ${esc(D.PAY_LABEL[o.payMethod] || o.payMethod)}.</p>
      </div>
    </section>`;
}
