// ============================================================================
// The bag.
//
// ⚠️ Every mutation here takes a LINE KEY (pid|colour|size), never a product
// id. Two colours of one bed cover are two lines, and keying on the product id
// would silently increment the first — the customer then receives two of the
// wrong colour and nothing in the UI ever looked wrong.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, h1, emptyState, toast, notice } from '../ui.js';
import { priceBlock, qtyStepper } from '../components.js';
import { art } from '../art.js';
import { seal } from '../brand.js';
import { icon } from '../icons.js';
import * as D from '../domain.js';

router.registerScreen('cart', async (host) => {
  await paint(host);
  // The bag has to follow a change made in another tab, or two windows side by
  // side disagree about what is in it.
  router.onLeave(store.live.subscribe('cart', () => paint(host)));
});

async function paint(host) {
  const [lines, shop, coupon] = await Promise.all([
    store.cart.lines(), store.catalog.shop(), store.cart.coupon(),
  ]);

  if (!lines.length) {
    host.innerHTML = h1('Your bag', 'Shopping')
      + emptyState(seal(64), 'Your bag is empty.',
        'Everything we make is in small batches. New Arrivals is a good place to start.',
        'Browse new arrivals', '#/new');
    return;
  }

  const products = await Promise.all(lines.map((l) => store.catalog.byId(l.pid)));
  const t = await store.cart.totals();

  const rows = lines.map((l, i) => {
    const p = products[i];
    if (!p) return '';
    const key = D.lineKey(l);
    const label = D.variantLabel(p, l.variant);
    const unit = D.variantPrice(p, l.variant);
    const max = p.kind === 'voucher' ? 99 : p.stock;
    const over = p.kind !== 'voucher' && l.qty > p.stock;

    return `<div class="cart-line" data-key="${esc(key)}">
      <a class="cart-thumb" href="#/p/${esc(p.slug)}">${art(p, 0)}</a>
      <div class="cart-mid">
        <a href="#/p/${esc(p.slug)}" class="card-name">${esc(p.name)}</a>
        ${label ? `<div class="cart-variant">${esc(label)}</div>` : ''}
        <div class="price"><span class="price-now">${D.rupees(unit)}</span>
          <span class="t-micro dim">each</span></div>
        ${over ? `<div class="t-micro" style="color:var(--alert-ink)">
          Only ${p.stock} left — reduce the quantity before checking out.</div>` : ''}
      </div>
      <div class="cart-right">
        ${qtyStepper(key, l.qty, max)}
        <div class="price"><span class="price-now">${D.rupees(unit * l.qty)}</span></div>
        <button type="button" class="cart-remove" data-remove="${esc(key)}">Remove</button>
      </div>
    </div>`;
  }).join('');

  const toFree = t.toFree > 0 && t.physical > 0
    ? `<div class="notice notice-info" style="margin-bottom:var(--s4)">
        ${icon('truck', 18)}
        <div>Add ${D.rupees(t.toFree)} more and shipping is free.</div></div>`
    : '';

  host.innerHTML = `
  ${h1('Your bag', 'Shopping', `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`)}
  <div class="two-col">
    <div>
      ${toFree}
      ${rows}
      <div style="margin-top:var(--s5)">
        <a class="btn-ghost" href="#/shop">${icon('left', 14)} Continue shopping</a>
      </div>
    </div>

    <aside class="panel panel-sticky">
      <h3 class="t-h3">Order summary</h3>

      <div class="totals">
        <div class="total-row muted"><span>Items</span><span>${D.rupees(t.items)}</span></div>
        ${t.saved ? `<div class="total-row save">
          <span>You save</span><span>&minus;${D.rupees(t.saved)}</span></div>` : ''}
        ${t.discount ? `<div class="total-row save">
          <span>Coupon ${esc(coupon ? coupon.code : '')}</span>
          <span>&minus;${D.rupees(t.discount)}</span></div>` : ''}
        <div class="total-row muted"><span>Shipping</span>
          <span>${t.shipping ? D.rupees(t.shipping)
            : (t.physical === 0 ? 'Nothing to ship' : 'Free')}</span></div>
        ${t.bulky ? `<div class="total-row muted">
          <span>Bulky item handling</span><span>${D.rupees(t.bulky)}</span></div>` : ''}
        <div class="total-row grand"><span>Total</span><span>${D.rupees(t.grand)}</span></div>
      </div>

      <div style="margin-top:var(--s5)">
        <div class="t-eyebrow" style="color:var(--ink-soft);margin-bottom:var(--s2)">
          Discount code</div>
        ${coupon
          ? `<div class="notice notice-good" style="padding:var(--s3)">
              ${icon('check', 16)}
              <div><b>${esc(coupon.code)}</b> applied.
              <button type="button" class="cart-remove" data-uncoupon
                style="margin-left:var(--s2)">Remove</button></div></div>`
          : `<div class="coupon">
              <input type="text" data-code placeholder="Enter a code"
                aria-label="Discount code" autocomplete="off">
              <button type="button" class="btn btn-secondary btn-sm" data-apply>Apply</button>
            </div>
            <div class="t-micro dim" style="margin-top:var(--s2)" data-couponmsg></div>`}
      </div>

      <div style="margin-top:var(--s5)">
        <a class="btn btn-primary btn-block" href="#/checkout">Proceed to checkout</a>
      </div>

      <div style="margin-top:var(--s3)">
        ${notice('info', 'Your bag is saved in this browser. It survives a '
          + 'refresh, and it does not follow you to another device.')}
      </div>
    </aside>
  </div>`;

  wire(host);
}

function wire(host) {
  host.addEventListener('click', async (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      const box = step.closest('[data-qty]');
      const key = box.dataset.qty;
      const cur = Number(box.querySelector('.qty-val').textContent);
      await store.cart.setQty(key, cur + Number(step.dataset.step));
      return;   // the live subscription repaints
    }

    const rm = e.target.closest('[data-remove]');
    if (rm) {
      await store.cart.remove(rm.dataset.remove);
      toast('Removed from your bag');
      return;
    }

    if (e.target.closest('[data-uncoupon]')) {
      await store.cart.clearCoupon();
      toast('Coupon removed');
      return;
    }

    if (e.target.closest('[data-apply]')) {
      const input = host.querySelector('[data-code]');
      const msg = host.querySelector('[data-couponmsg]');
      const res = await store.cart.applyCoupon(input.value);
      if (res.ok) { toast(`${res.coupon.code} applied`); }
      else if (msg) { msg.textContent = res.reason; msg.style.color = 'var(--alert-ink)'; }
    }
  });

  const input = host.querySelector('[data-code]');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); host.querySelector('[data-apply]').click(); }
    });
  }
}
