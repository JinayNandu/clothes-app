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
import { signInBox, wireSignIn } from '../signin.js';
import { OTP_LEN } from '../config.js';
import { drawQR } from '../pay.js';
import { seal, ornament } from '../brand.js';
import { art } from '../art.js';
import { orderChain } from '../components.js';
import { icon } from '../icons.js';
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
  const [first, shop, all] = await Promise.all([
    store.orders.byCode(r.params.code), store.catalog.shop(), store.catalog.all(),
  ]);
  if (mine !== generation) return;

  if (!first && store.shared() && store.account) {
    host.innerHTML = emptyState(seal(64), 'We cannot find that order here.',
      'An order opens on the phone it was placed from, and on any phone signed in to '
      + 'the account it belongs to. Sign in on your account page, check the code, or '
      + 'write to us with it.',
      'Your account', '#/account');
    return;
  }
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
  host.innerHTML = page(order, shop, all);
  drawPay(host, order, shop);
  drawKeep(host);

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
      ['[data-sub]', subLine(order)],
      ['[data-pill]', pill(order)],
      ['[data-chain]', orderChain(order)],
      ['[data-arrive]', arriveLine(order, shop)],
      ['[data-status]', statusBlock(order, shop)],
      ['[data-track]', track(order)],
      // Each item's status and the money move with the store's taps too. No
      // input lives in here, so a redraw cannot take anything typed.
      ['[data-ordered]', ordered(order, all)],
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
// THE ORDER'S DETAILS, in the order a customer reads them (8 November 2026,
// the owner's ask: "another page that gives details of that order and the
// shipping chain … highlighting the part that is done"): where it is -- the
// chain, live -- then what it says about that, what was bought and for how
// much (each item opening its product), every step with its date, the
// payment, then help. A draft is the exception: it has reached nobody yet, so
// handing it over comes straight after its status.
function page(o, shop, all) {
  const handoff = `
    <section class="panel" style="margin-top:var(--s4)">
      <div data-handoff-head>${handoffHead(o)}</div>
      <div data-handoff>${handoffBlock(D.orderSummaryText(o, shop), shop,
        { subject: 'Order ' + o.code })}</div>
    </section>`;
  return `
  <div class="od">
    <a class="btn-ghost od-back" href="#/account">${icon('left', 14)} Your orders</a>
    <header class="od-head">
      <div class="od-head-mid">
        <h1 class="t-h1" data-title>${title(o)}</h1>
        <p class="od-sub" data-sub>${subLine(o)}</p>
      </div>
      <span data-pill>${pill(o)}</span>
    </header>
    <p class="arrive" data-arrive>${arriveLine(o, shop)}</p>

    <section class="panel od-chain" aria-label="Where it is">
      <div data-chain>${orderChain(o)}</div>
    </section>

    <div data-status style="margin-top:var(--s4)">${statusBlock(o, shop)}</div>

    ${o.status === 'draft' ? handoff : ''}

    <div data-ordered>${ordered(o, all)}</div>

    <section class="panel" style="margin-top:var(--s4)">
      <h2 class="t-h3">Every step, with its date</h2>
      <div data-track>${track(o)}</div>
    </section>

    <div data-pay></div>

    ${o.status === 'draft' ? '' : handoff}

    <div data-keep></div>

    <div style="margin-top:var(--s6)">${ornament()}</div>

    <div style="display:flex;gap:var(--s3);justify-content:center;margin-top:var(--s5);
                flex-wrap:wrap">
      <a class="btn btn-secondary" href="#/shop">Continue shopping</a>
      <a class="btn btn-secondary" href="#/account">Your orders</a>
    </div>
  </div>`;
}

const title = (o) =>
  `${o.status === 'draft' ? 'Order request' : 'Order'} ${esc(o.code)}`;

/** "Placed 8 Nov 2026, 00:52 · 2 items · ₹6,096". */
function subLine(o) {
  const n = (o.lines || []).reduce((k, l) => k + (l.status === 'cancelled' ? 0 : l.qty), 0);
  return `${o.sentVia === 'online' ? 'Placed' : 'Saved'} ${esc(D.fmtStamp(o.createdAt))} ·
    ${n} ${n === 1 ? 'item' : 'items'} · ${D.rupees(o.grand)}`;
}

/** Where it is, in one word, the same word as on Your orders. */
function pill(o) {
  const word = o.status === 'sent' ? (o.sentVia === 'online' ? 'Ordered' : 'Sent')
    : o.status === 'abandoned' && o.sentVia === 'online' ? 'Cancelled'
    : D.STATUS_LABEL[o.status];
  return `<span class="pill pill-${D.STATUS_TONE[o.status]}">${esc(word)}</span>`;
}

/**
 * KEEP IT ON ANY PHONE. A guest's order page is the moment the offer means
 * something: this order, and every one after it, wherever they sign in. An
 * offer, under the order and its payment -- never in front of them, and gone
 * for good once taken. Drawn once into its own box, which the live refresh
 * above never touches, so a status change cannot wipe a code half typed.
 */
async function drawKeep(host) {
  const box = host.querySelector('[data-keep]');
  if (!box || !store.account) return;
  const who = await store.account.whoami();
  if (!who || !who.guest || !box.isConnected) return;
  box.innerHTML = `
    <section class="panel" style="margin-top:var(--s4)">
      <h2 class="t-h3">Keep this order on any phone</h2>
      <div style="margin-top:var(--s3)">
        ${signInBox(`Add your email and we send you a ${OTP_LEN}-digit code — there is no
          password. This order, and every one after it, then opens wherever you sign in.`)}
      </div>
    </section>`;
  wireSignIn(box, (w) => {
    box.innerHTML = `<div style="margin-top:var(--s4)">${notice('good',
      `<b>Signed in as ${esc(w.email)}.</b> This order is in your account now, and opens `
      + 'on any phone where you sign in.')}</div>`;
  });
}

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
      // An order placed online WAS sent to us -- it reached the shop the moment
      // it existed -- so for one of those "abandoned" means the shop closed it
      // before confirming, and the customer reads it as what it is: cancelled.
      if (o.sentVia === 'online') {
        return notice('bad', `<b>Cancelled on ${at('abandoned')}.</b> Nothing will be `
          + 'sent. If you had already paid, write to us below so we can return the money.');
      }
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
/** The customer's word for a step. Online, "sent to us" is placing the order,
 *  and a shop closing it before confirming is a cancellation. */
function stepLabel(o, status) {
  if (o.sentVia === 'online' && status === 'sent') return 'Order placed';
  if (o.sentVia === 'online' && status === 'abandoned') return 'Cancelled';
  return D.TRACK_LABEL[status];
}

function track(o) {
  const ship = shipText(o);
  return `<ol class="track">${D.trackSteps(o).map((s) => `
    <li class="is-${s.state}">
      <span class="track-l">${esc(stepLabel(o, s.status))}${s.state === 'now'
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
// The amount is in it since items can be cancelled: a QR left showing the old
// total would ask for money the order no longer comes to.
const keyOfPay = (o) => [o.paid, ['cancelled', 'abandoned'].includes(o.status),
  o.status === 'draft', o.grand, o.refunded || 0, D.refundDue(o)].join('|');

function drawPay(host, o, shop) {
  const box = host.querySelector('[data-pay]');
  if (!box) return;
  box.innerHTML = payPanel(o, shop);
  const qr = box.querySelector('[data-qr]');
  if (qr) drawQR(qr, shop, o);
}

function payPanel(o, shop) {
  if (o.paid) {
    // What is owed back after a cancellation, and when it was sent: both the
    // shop's own notes (mark_refund), never anything this page saw happen.
    const due = D.refundDue(o);
    return `<section class="panel" style="margin-top:var(--s4)">
      <h2 class="t-h3">Payment</h2>
      <div style="margin-top:var(--s3)">${notice('good',
        `<b>Paid, ${D.rupees(o.paidAmount || o.grand)}.</b> ${esc(shop.brand.name)} confirmed the `
      + `payment on ${esc(D.fmtStamp(o.paidAt))}.`)}</div>
      ${due > 0 ? `<div style="margin-top:var(--s3)">${notice('info',
        `<b>We owe you ${D.rupees(due)}</b> for what was cancelled. We send it back to the `
      + 'account you paid from, and this page shows it once we have.')}</div>` : ''}
      ${o.refunded ? `<div style="margin-top:var(--s3)">${notice('good',
        `<b>We sent ${D.rupees(o.refunded)} back to you</b>${o.refundedAt
          ? ` on ${esc(D.fmtStamp(o.refundedAt))}` : ''}.`)}</div>` : ''}
    </section>`;
  }
  // Nothing to pay on an order that will never be sent.
  if (['cancelled', 'abandoned'].includes(o.status)) return '';

  if (o.payMethod === 'upi') {
    return `
      <section class="panel" style="margin-top:var(--s4)">
        <h2 class="t-h3">Paying by UPI</h2>
        <div style="display:flex;gap:var(--s5);align-items:center;flex-wrap:wrap;
                    margin-top:var(--s4)">
          <div class="qr-tile" data-qr></div>
          <div style="flex:1;min-width:220px">
            <div class="total-row grand" style="border:0;padding:0">
              <span>Amount</span><span>${D.rupees(o.grand)}</span></div>
            <p class="t-micro dim" style="margin-top:var(--s3)">
              Scan with GPay, PhonePe, Paytm or your bank app. The amount and
              your order code travel in the QR, so there is nothing to type.</p>
            <!-- ⚠️ Still true to the letter: a person at the shop marks an
                 order paid after seeing the money arrive (set_paid), and on a
                 database this page shows it. Nothing here claims to watch the
                 payment. In one browser the shop sees only what is sent. -->
            <p class="t-micro" style="margin-top:var(--s3);color:var(--ink-soft)">
              ${store.shared()
                ? 'Once the money reaches us, we confirm the payment on this page.'
                : 'Send us the payment screenshot with the order, and we will check '
                  + 'it against our own bank record.'}</p>
            <div class="pay-proof">${notice('info', '<b>Keep your payment screenshot.</b> '
              + 'Please show it to the delivery partner when your parcel arrives.')}</div>
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
/** Each item's status in the customer's words, when the items differ. */
const ITEM_SAYS = {
  sent: 'Ordered', confirmed: 'Confirmed', packed: 'Packed', shipped: 'On its way',
  delivered: 'Delivered', returned: 'Returned', cancelled: 'Cancelled by us',
};

function ordered(o, all) {
  const c = o.customer || {};
  const byId = (id) => (all || []).find((p) => p.id === id);
  // Each item's own status is shown only where it says something the
  // timeline does not: when the items still on their way differ, or when one
  // was cancelled. All alike, the timeline above says it once.
  const per = D.hasItemStatus(o);
  const live = per ? o.lines.filter((l) => l.status !== 'cancelled') : [];
  const mixed = per && new Set(live.map((l) => l.status)).size > 1;
  const was = D.placedGrand(o);
  return `
    <section class="panel" style="margin-top:var(--s4)">
      <h2 class="t-h3">What you ordered</h2>
      <div class="olines">
        ${o.lines.map((l) => {
          // The photograph of the colour bought, while the product is still
          // sold. The words and the money are the order's own either way.
          const p = byId(l.pid);
          const col = p && p.variants && (p.variants.colour || [])
            .find((x) => x.id === (l.variant || {}).colour);
          const view = col && col.img != null ? col.img : 0;
          const gone = per && l.status === 'cancelled';
          const say = per && (gone || mixed) ? ITEM_SAYS[l.status] : '';
          const sh = per && l.shipment && (l.shipment.courier || l.shipment.ref)
            ? `With ${l.shipment.courier || 'the courier'}${l.shipment.ref
              ? `, tracking number ${l.shipment.ref}` : ''}` : '';
          // The whole row opens the product, while it is still sold (the
          // owner, 8 November 2026: "if I click on any product, it should open
          // that product"). Gone from the catalogue, the row is only a record.
          const tag = p ? `a href="#/p/${esc(p.slug)}"` : 'div';
          return `<${tag} class="oline${gone ? ' is-cancelled' : ''}${p ? ' is-link' : ''}">
            <span class="oline-pic" aria-hidden="true">${p ? art(p, view) : ''}</span>
            <span class="oline-mid">
              <span class="oline-name">${esc(l.name)}</span>
              ${l.variantLabel ? `<span class="oline-meta">${esc(l.variantLabel)}</span>` : ''}
              <span class="oline-meta">${D.rupees(l.unitPrice)} &times; ${l.qty}</span>
              ${say ? `<span class="oline-state is-${esc(l.status)}">${esc(say)}</span>` : ''}
              ${sh && !gone ? `<span class="oline-meta">${esc(sh)}</span>` : ''}
            </span>
            <span class="oline-sum">${D.rupees(l.lineTotal)}${p
              ? `<span class="oline-go">${icon('chevron', 14)}</span>` : ''}</span>
          </${p ? 'a' : 'div'}>`;
        }).join('')}
      </div>
      ${per && was !== o.grand && !['cancelled', 'abandoned'].includes(o.status)
        ? `<p class="t-micro dim" style="margin-top:var(--s3)">The total was ${D.rupees(was)}
            before we cancelled an item; it now comes to ${D.rupees(o.grand)}.</p>` : ''}
      <div class="totals" style="margin-top:var(--s4)">
        <div class="total-row muted">
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
