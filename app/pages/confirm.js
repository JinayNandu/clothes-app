// ============================================================================
// Order confirmation — and the most carefully worded screen on the site.
//
// ⚠️ IT NEVER SAYS "order confirmed", "order placed successfully", "thank you
// for your purchase" or "payment successful". None of those is true. The order
// is a record in this browser; DEVI has not seen it; no money has moved.
//
// What it DOES say is exactly what has happened and exactly what to do next.
// tools/honesty.pl greps this project for all four phrases and fails on any of
// them.
//
// Tapping a handoff button moves the order draft -> sent. Nothing else does,
// and nothing advances on a timer.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, emptyState, notice, toast } from '../ui.js';
import { handoffBlock, wireHandoff } from '../handoff.js';
import { drawQR, demoStrip } from '../pay.js';
import { seal, ornament } from '../brand.js';
import { icon } from '../icons.js';
import * as D from '../domain.js';

router.registerScreen('confirm', async (host, r) => {
  const order = await store.orders.byCode(r.params.code);
  const shop = await store.catalog.shop();

  if (!order) {
    host.innerHTML = emptyState(seal(64), 'We cannot find that order.',
      'Orders are saved in the browser they were created in. If you placed this '
      + 'one on another device or cleared your browser data, it is not here — '
      + 'but if you sent it to us, we still have it.',
      'Contact us', '#/contact');
    return;
  }

  const text = D.orderSummaryText(order, shop);
  const sent = order.status !== 'draft';

  host.innerHTML = `
  <div style="max-width:720px;margin:0 auto">
    <div style="text-align:center;margin-bottom:var(--s5)">
      <span style="color:var(--gold)">${seal(56)}</span>
      <h1 class="t-h1" style="margin-top:var(--s3)">
        Order request saved &mdash; ${esc(order.code)}</h1>
      <p class="t-micro dim" style="margin-top:var(--s2)">
        ${D.fmtStamp(order.createdAt)}</p>
    </div>

    <div data-status>${statusBlock(order, shop)}</div>

    <section class="panel" style="margin-top:var(--s5)">
      <h2 class="t-h3">Send it to us</h2>
      <p class="t-micro dim" style="margin:var(--s2) 0 var(--s4)">
        Any one of these. The whole order travels with it &mdash; you do not
        need to type anything.</p>
      <div data-handoff>${handoffBlock(text, shop, { subject: 'Order ' + order.code })}</div>
    </section>

    ${order.payMethod === 'upi' ? `
      <section class="panel" style="margin-top:var(--s4)">
        <h2 class="t-h3">Paying by UPI</h2>
        ${demoStrip(shop.upi)}
        <div style="display:flex;gap:var(--s5);align-items:center;flex-wrap:wrap;
                    margin-top:var(--s4)">
          <div class="qr-tile" data-qr></div>
          <div style="flex:1;min-width:220px">
            <div class="total-row grand" style="border:0;padding:0">
              <span>Amount</span><span>${D.rupees(order.grand)}</span></div>
            <p class="t-micro dim" style="margin-top:var(--s3)">
              Scan with GPay, PhonePe, Paytm or your bank app. The amount and
              your order code travel in the QR, so there is nothing to type.</p>
            <p class="t-micro" style="margin-top:var(--s3);color:var(--ink-soft)">
              <b>Nothing here can see whether you paid.</b> UPI sends no message
              back to a web page. Please send us the payment screenshot along
              with the order, and we will confirm against our own bank record.</p>
          </div>
        </div>
      </section>` : `
      <section class="panel" style="margin-top:var(--s4)">
        <h2 class="t-h3">Cash on delivery</h2>
        <p class="t-micro dim" style="margin-top:var(--s2)">
          Pay the courier ${D.rupees(order.grand)} when the parcel arrives.
          We will still need you to send the order through above, so a person
          here can confirm it and dispatch.</p>
      </section>`}

    <section class="panel" style="margin-top:var(--s4)">
      <h2 class="t-h3">What you ordered</h2>
      <div class="totals" style="margin-top:var(--s4)">
        ${order.lines.map((l) => `
          <div class="total-row muted">
            <span>${l.qty} &times; ${esc(l.name)}${l.variantLabel
              ? `<br><span class="t-micro dim">${esc(l.variantLabel)}</span>` : ''}</span>
            <span>${D.rupees(l.lineTotal)}</span></div>`).join('')}
        <div class="total-row muted" style="border-top:1px solid var(--edge);padding-top:var(--s3)">
          <span>Items</span><span>${D.rupees(order.itemsTotal)}</span></div>
        ${order.discount ? `<div class="total-row save">
          <span>Coupon ${esc(order.coupon)}</span>
          <span>&minus;${D.rupees(order.discount)}</span></div>` : ''}
        <div class="total-row muted"><span>Shipping</span>
          <span>${order.shipping ? D.rupees(order.shipping) : 'Free'}</span></div>
        ${order.bulky ? `<div class="total-row muted">
          <span>Bulky item handling</span><span>${D.rupees(order.bulky)}</span></div>` : ''}
        <div class="total-row grand"><span>Total</span><span>${D.rupees(order.grand)}</span></div>
      </div>

      <div style="margin-top:var(--s5);padding-top:var(--s4);border-top:1px solid var(--edge)">
        <div class="t-eyebrow" style="color:var(--ink-soft);margin-bottom:var(--s2)">
          Delivering to</div>
        <p class="t-micro user-text" style="line-height:1.7">
          ${esc(order.customer.name)}<br>
          ${esc(order.customer.addr)}<br>
          ${esc(order.customer.city)}, ${esc(order.customer.state)}
          ${esc(order.customer.pin)}<br>
          ${esc(order.customer.mobile)}${order.customer.email
            ? ' · ' + esc(order.customer.email) : ''}
        </p>
      </div>
    </section>

    <div style="margin-top:var(--s6)">${ornament()}</div>

    <div style="display:flex;gap:var(--s3);justify-content:center;margin-top:var(--s5);
                flex-wrap:wrap">
      <a class="btn btn-secondary" href="#/shop">Continue shopping</a>
      <a class="btn btn-secondary" href="#/account">Your orders</a>
    </div>
  </div>`;

  // The QR is drawn after the markup exists, because the library writes into
  // a real element.
  const qr = host.querySelector('[data-qr]');
  if (qr) drawQR(qr, shop, order);

  wireHandoff(host.querySelector('[data-handoff]'), async (via) => {
    if (order.status !== 'draft') return;
    try {
      const updated = await store.orders.markSent(order.id, via);
      order.status = updated.status;
      order.sentAt = updated.sentAt;
      order.sentVia = updated.sentVia;
      host.querySelector('[data-status]').innerHTML = statusBlock(order, shop);
      toast('Marked as sent. We will reply to confirm.');
    } catch (e) {
      console.error(e);
    }
  });
});

// ---------------------------------------------------------------------------
// The status block. Two states, and neither of them claims more than is true.
// ---------------------------------------------------------------------------
function statusBlock(order, shop) {
  if (order.status === 'draft') {
    return notice('warn',
      `<b>${esc(shop.brand.name)} has not received this yet.</b> There is no `
    + 'server behind this website, so saving an order does not send it '
    + 'anywhere. It is a record in this browser, with a code, waiting for you '
    + 'to hand it over using one of the buttons below.');
  }

  const via = { whatsapp: 'on WhatsApp', phone: 'by phone',
                email: 'by email', copy: 'by copying it' }[order.sentVia] || '';

  // ⚠️ "Sent", never "confirmed". Only a human at DEVI can confirm, and that
  // happens in the admin, not here.
  return notice('good',
    `<b>Sent ${esc(via)} at ${esc(D.fmtStamp(order.sentAt))}.</b> `
  + 'We will reply to confirm the order and the delivery date. Until somebody '
  + `at ${esc(shop.brand.name)} replies, nothing is confirmed and nothing has `
  + 'been dispatched.');
}
