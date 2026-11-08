// ============================================================================
// The bag.
//
// ⚠️ Every mutation here takes a LINE KEY (pid|colour|size), never a product
// id. Two colours of one shirt are two lines, and keying on the product id
// would silently increment the first — the customer then receives two of the
// wrong colour and nothing in the UI ever looked wrong.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, h1, emptyState, toast, notice } from '../ui.js';
import { priceBlock, qtyStepper, rail } from '../components.js';
import { art } from '../art.js';
import { seal } from '../brand.js';
import { icon } from '../icons.js';
import * as D from '../domain.js';

// The products this customer has ordered before, for the suggestions: null
// until known. Read once per visit -- the bag repaints on every + and −, and
// asking the server each time would be a request per tap.
let past = null;

router.registerScreen('cart', async (host) => {
  // ⚠️ WIRED ONCE PER SCREEN, NEVER PER PAINT. paint() used to wire, so every
  // repaint added one more click listener to this same element, and each
  // tap's write repainted once per listener: a + tapped six times ran
  // setQty 1, 2, 4, 8, 16 and 32 times (measured 8 November 2026). The
  // count stayed right only because every call wrote the same number.
  if (!host.dataset.wired) {
    wire(host);
    host.dataset.wired = '1';
  }
  past = null;
  pastIds().then((ids) => { past = ids; paintRecs(host); });
  await paint(host);
  // The bag has to follow a change made in another tab, or two windows side by
  // side disagree about what is in it.
  router.onLeave(store.live.subscribe('cart', () => paint(host)));
});

/** What this customer has ordered before: every item of every order not
 *  cancelled, from the server once signed in, or from this browser. */
async function pastIds() {
  try {
    const orders = await store.orders.mine();
    return orders.filter((o) => !['cancelled', 'abandoned'].includes(o.status))
      .flatMap((o) => (o.lines || []).filter((l) => l.status !== 'cancelled').map((l) => l.pid));
  } catch (e) {
    return [];      // suggestions are a nicety; a failed read leaves them to the bag
  }
}

// ---------------------------------------------------------------------------
// OTHER PRODUCTS YOU MAY LIKE (8 November 2026, the owner's ask): the same
// categories as the bag and as every earlier order (D.alsoLike), after the
// bag's lines -- so on a phone they come before the order summary. The cards
// are the shop's own, with Add to bag and its sizes; one added moves up into
// the bag and out of the suggestions.
// ---------------------------------------------------------------------------
function recsHtml(all, lines, shop, wishIds) {
  const list = D.alsoLike(all, lines.map((l) => l.pid), past || [], 6);
  return rail('cart-recs', 'Other products you may like', list, shop, wishIds);
}

async function paintRecs(host) {
  const box = host.querySelector('[data-recs]');
  if (!box) return;
  const [all, lines, shop, wishIds] = await Promise.all([
    store.catalog.all(), store.cart.lines(), store.catalog.shop(), store.wishlist.ids(),
  ]);
  if (box.isConnected) box.innerHTML = recsHtml(all, lines, shop, wishIds);
}

async function paint(host) {
  const [lines, shop, coupon, all, wishIds] = await Promise.all([
    store.cart.lines(), store.catalog.shop(), store.cart.coupon(),
    store.catalog.all(), store.wishlist.ids(),
  ]);

  if (!lines.length) {
    // Empty, the suggestions follow the earlier orders alone.
    host.innerHTML = h1('Your bag', 'Shopping')
      + emptyState(seal(64), 'Your bag is empty.',
        'Everything we make is in small batches. New Arrivals is a good place to start.',
        'Browse new arrivals', '#/new')
      + `<div class="cart-recs" data-recs>${recsHtml(all, lines, shop, wishIds)}</div>`;
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
    // The stock of THIS colour in THIS size (8 November 2026), not the
    // product's total: there may be ten shirts and one of them an XL.
    const max = D.lineMax(p, l.variant);
    const over = p.kind !== 'voucher' && l.qty > max;
    const left = D.skuStock(p, l.variant);

    return `<div class="cart-line" data-key="${esc(key)}">
      <a class="cart-thumb" href="#/p/${esc(p.slug)}">${art(p, 0)}</a>
      <div class="cart-mid">
        <a href="#/p/${esc(p.slug)}" class="card-name">${esc(p.name)}</a>
        ${label ? `<div class="cart-variant">${esc(label)}</div>` : ''}
        <div class="price"><span class="price-now">${D.rupees(unit)}</span>
          <span class="t-micro dim">each</span></div>
        ${over ? `<div class="t-micro" style="color:var(--alert-ink)">
          ${!left ? `Sold out in this ${label ? 'size' : 'style'} — remove it before checking out.`
            : left > max ? `At most ${max} of one style in an order — reduce the quantity before checking out.`
              : `Only ${max} left in this ${label ? 'size' : 'style'} — reduce the quantity before checking out.`}</div>` : ''}
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
      <div class="cart-recs" data-recs>${recsHtml(all, lines, shop, wishIds)}</div>
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
}

/** Every control on the bag, delegated from the screen itself: wired once
 *  (see the top of this file), so a repaint never adds a second listener. */
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

  // Enter in the discount code applies it. Delegated as well: the field is
  // drawn anew with every paint.
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('[data-code]')) return;
    e.preventDefault();
    const apply = host.querySelector('[data-apply]');
    if (apply) apply.click();
  });
}
