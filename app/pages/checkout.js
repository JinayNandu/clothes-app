// ============================================================================
// Checkout.
//
// ⚠️ The button says "Save this order", not "Place order" or "Pay now",
// because that is what it does. An order the merchant has never seen is not
// placed, and this page cannot send anything anywhere — the next screen is
// where it is handed over.
//
// ⚠️ NO <form action>. There is nothing to POST to. tools/honesty.pl fails on
// one, because that is the shape a fake submission takes.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, h1, emptyState, notice, toast } from '../ui.js';
import { field, setFieldError } from '../components.js';
import { payOptions, demoStrip } from '../pay.js';
import { seal } from '../brand.js';
import { icon } from '../icons.js';
import * as D from '../domain.js';

router.registerScreen('checkout', async (host) => {
  const [lines, shop, profile, coupon] = await Promise.all([
    store.cart.lines(), store.catalog.shop(),
    store.profile.get(), store.cart.coupon(),
  ]);

  if (!lines.length) {
    host.innerHTML = h1('Checkout', 'Shopping')
      + emptyState(seal(64), 'There is nothing to check out.',
        'Your bag is empty. Everything we make is in small batches, so it is worth a look before a piece goes.',
        'Shop all', '#/shop');
    return;
  }

  const t = await store.cart.totals();
  const products = await Promise.all(lines.map((l) => store.catalog.byId(l.pid)));
  const gw = D.gatewayState(shop.gateway);

  // UPI first — it is the one that actually works today.
  let pay = 'upi';

  host.innerHTML = `
  ${h1('Checkout', 'Almost there')}

  ${notice('warn', '<b>This page does not take payment and cannot send your '
    + 'order.</b> Saving it creates a record in this browser with an order '
    + 'code. The next screen is where you hand it to us — on WhatsApp, by '
    + 'phone or by email — and nothing reaches ' + esc(shop.brand.name)
    + ' until you do.')}

  <div class="two-col" style="margin-top:var(--s5)">
    <div>
      <section class="panel">
        <h3 class="t-h3">Where it goes</h3>
        <div class="form-grid">
          ${field('name', 'Full name', { required: true, value: profile.name, span: true })}
          ${field('mobile', 'Mobile number', { required: true, value: profile.mobile,
            type: 'tel', inputmode: 'numeric', placeholder: '10 digits', maxlength: 13 })}
          ${field('email', 'Email', { value: profile.email, type: 'email',
            placeholder: 'For the order confirmation' })}
          ${field('addr', 'Address', { required: true, value: profile.addr, rows: 3,
            span: true, placeholder: 'Flat, building, street, area' })}
          ${field('city', 'City', { required: true, value: profile.city })}
          ${field('pin', 'PIN code', { required: true, value: profile.pin,
            inputmode: 'numeric', maxlength: 6 })}
          ${field('state', 'State', { required: true, value: profile.state,
            options: D.STATES, span: true })}
        </div>
      </section>

      <section class="panel" style="margin-top:var(--s4)">
        <h3 class="t-h3">How you would like to pay</h3>
        <div data-pay>${payOptions(shop, pay)}</div>
        <div style="margin-top:var(--s4)" data-paynote></div>
      </section>
    </div>

    <aside class="panel panel-sticky">
      <h3 class="t-h3">Your order</h3>
      <div style="display:flex;flex-direction:column;gap:var(--s2);margin-bottom:var(--s4)">
        ${lines.map((l, i) => {
          const p = products[i];
          if (!p) return '';
          const label = D.variantLabel(p, l.variant);
          const unit = D.variantPrice(p, l.variant);
          return `<div class="total-row muted">
            <span>${l.qty} &times; ${esc(p.name)}${label
              ? `<br><span class="t-micro dim">${esc(label)}</span>` : ''}</span>
            <span>${D.rupees(unit * l.qty)}</span></div>`;
        }).join('')}
      </div>

      <div class="totals">
        <div class="total-row muted"><span>Items</span><span>${D.rupees(t.items)}</span></div>
        ${t.discount ? `<div class="total-row save">
          <span>Coupon ${esc(coupon ? coupon.code : '')}</span>
          <span>&minus;${D.rupees(t.discount)}</span></div>` : ''}
        <div class="total-row muted"><span>Shipping</span>
          <span>${t.shipping ? D.rupees(t.shipping)
            : (t.physical === 0 ? 'Nothing to ship' : 'Free')}</span></div>
        ${t.bulky ? `<div class="total-row muted">
          <span>Bulky item handling</span><span>${D.rupees(t.bulky)}</span></div>` : ''}
        <div class="total-row grand"><span>Payable</span><span>${D.rupees(t.grand)}</span></div>
      </div>

      <div style="margin-top:var(--s5)">
        <button type="button" class="btn btn-primary btn-block" data-save>
          Save this order</button>
        <p class="t-micro dim" style="margin-top:var(--s3);text-align:center">
          You will be able to send it to us on the next screen.</p>
      </div>

      <div style="margin-top:var(--s4)">
        <a class="btn-ghost" href="#/cart">${icon('left', 14)} Back to the bag</a>
      </div>
    </aside>
  </div>`;

  paintPayNote();

  // -------------------------------------------------------------------------
  function paintPayNote() {
    const box = host.querySelector('[data-paynote]');
    if (pay === 'upi') {
      box.innerHTML = demoStrip(shop.upi)
        || notice('info', 'A QR with the exact amount and your order code '
          + 'appears on the next screen.');
    } else if (pay === 'cod') {
      box.innerHTML = notice('info', 'Pay the courier when the parcel arrives. '
        + 'We will still need you to send the order through so we can confirm it.');
    } else {
      box.innerHTML = notice('warn', esc(gw.why));
    }
  }

  host.querySelector('[data-pay]').addEventListener('change', (e) => {
    if (e.target.name !== 'pay') return;
    pay = e.target.value;
    for (const l of host.querySelectorAll('.pay-opt')) {
      l.classList.toggle('on', l.querySelector('input').checked);
    }
    paintPayNote();
  });

  // -------------------------------------------------------------------------
  // VALIDATION — every message says what to do, not that something is wrong.
  // -------------------------------------------------------------------------
  function read() {
    const v = {};
    for (const n of ['name', 'mobile', 'email', 'addr', 'city', 'state', 'pin']) {
      const el = host.querySelector(`[name="${n}"]`);
      v[n] = el ? el.value.trim() : '';
    }
    return v;
  }

  function validate(v) {
    const errs = {};
    if (v.name.length < 2) errs.name = 'We need a name for the parcel.';
    if (!D.validMobile(v.mobile)) errs.mobile = 'A 10-digit Indian mobile, starting 6 to 9.';
    if (v.email && !D.validEmail(v.email)) errs.email = 'That does not look like an email address.';
    if (v.addr.length < 10) errs.addr = 'Flat or house number, building, street and area.';
    if (!v.city) errs.city = 'Which city?';
    if (!v.state) errs.state = 'Choose a state.';
    if (!D.validPin(v.pin)) errs.pin = 'Six digits, not starting with zero.';
    for (const n of ['name', 'mobile', 'email', 'addr', 'city', 'state', 'pin']) {
      setFieldError(host, n, errs[n] || null);
    }
    return errs;
  }

  host.querySelector('[data-save]').addEventListener('click', async () => {
    const v = read();
    const errs = validate(v);
    if (Object.keys(errs).length) {
      const first = host.querySelector('.field.bad input, .field.bad select, .field.bad textarea');
      if (first) { first.focus(); first.scrollIntoView({ block: 'center' }); }
      toast('Please check the highlighted fields');
      return;
    }

    // Stock is re-checked HERE, not only when the item went in the bag. A
    // basket can sit open across a sell-out.
    for (let i = 0; i < lines.length; i++) {
      const p = products[i];
      if (p && p.kind !== 'voucher' && lines[i].qty > p.stock) {
        toast(`Only ${p.stock} of ${p.name} left — please adjust your bag.`);
        router.go('/cart');
        return;
      }
    }

    await store.profile.save(v);
    // ⚠️ place() sets status 'draft' and paid false. It cannot do otherwise;
    // see backend-local.js.
    const order = await store.orders.place({ customer: v, payMethod: pay });
    router.go(`/order/${order.code}`);
  });
});
