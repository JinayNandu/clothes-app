// ============================================================================
// Product detail.
//
// The gallery is four views of the SAME seed: front, a 2.6x fabric close-up, a
// rotated flat-lay and — only when the product has more than one colour — the
// alternate colourway. On a photographed site the swatch interaction would
// need five more photographs; here it is an integer.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, crumbs, toast, emptyState, notice } from '../ui.js';
import { priceBlock, swatchRow, qtyStepper, productCard } from '../components.js';
import { art, viewCount } from '../art.js';
import { seal } from '../brand.js';
import { icon } from '../icons.js';
import * as D from '../domain.js';

router.registerScreen('product', async (host, r) => {
  const p = await store.catalog.bySlug(r.params.slug);
  const shop = await store.catalog.shop();

  if (!p) {
    host.innerHTML = emptyState(seal(64), 'We cannot find that style.',
      'It may have sold out and been retired, or the link may be mistyped.',
      'Shop all', '#/shop');
    return;
  }

  const cats = await store.catalog.categories();
  const cat = cats.find((c) => c.id === p.cat);
  const sub = cat && cat.sub.find((s) => s.id === p.sub);
  const wished = await store.wishlist.has(p.id);
  const related = await store.catalog.related(p.id, 4);
  const wishIds = await store.wishlist.ids();

  // Selection lives in a closure, not in the URL: a half-chosen variant is not
  // a place anyone wants to land from a shared link.
  const sel = {
    colour: p.variants && p.variants.colour && p.variants.colour.length
      ? p.variants.colour[0].id : null,
    size: p.variants && p.variants.size && p.variants.size.length
      ? p.variants.size[0].id : null,
  };
  let qty = 1;
  let view = 0;

  const badges = D.derivedBadges(p, shop);
  const out = badges.includes('sold-out');
  const low = badges.includes('low-stock');
  const views = viewCount(p);

  // ⚠️ An ESTIMATE, computed live, and that is correct HERE and nowhere else.
  // This screen answers "if I order today, when does it arrive" — a question
  // whose answer must move as today moves. The ORDER's estimate is a different
  // thing: it is the promise that was made, it is frozen into the order at
  // placement, and it is read back rather than recomputed. Confusing the two
  // is how a customer's delivery date quietly slides a day every day.
  const est = D.deliveryEstimate(shop.shipping);

  host.innerHTML = `
  ${crumbs([
    { label: 'Home', href: '#/' },
    { label: 'Shop', href: '#/shop' },
    ...(cat ? [{ label: cat.name, href: `#/c/${cat.slug}` }] : []),
    ...(sub && cat ? [{ label: sub.name, href: `#/c/${cat.slug}/${sub.slug}` }] : []),
    { label: p.name },
  ])}

  <div class="pdp">
    <div class="pdp-gallery">
      <div class="pdp-main" data-main>${art(p, 0)}</div>
      <div class="pdp-thumbs">
        ${Array.from({ length: views }, (_, i) => `
          <button type="button" class="pdp-thumb${i === 0 ? ' on' : ''}"
            data-view="${i}" aria-label="View ${i + 1}">${art(p, i)}</button>`).join('')}
      </div>
    </div>

    <div class="pdp-info">
      <div>
        <div class="t-eyebrow" style="color:var(--gold-ink)">${esc(sub ? sub.name : '')}</div>
        <h1 class="t-h1">${esc(p.name)}</h1>
      </div>

      <div data-price>${priceBlock(p, sel, true)}</div>
      <p class="t-long" style="color:var(--ink-soft)">${esc(p.desc)}</p>

      ${p.variants && p.variants.colour && p.variants.colour.length > 1 ? `
        <div class="pdp-opt">
          <div class="t-eyebrow">Colour: <span class="val" data-colour-label></span></div>
          <div data-swatches></div>
        </div>` : ''}

      ${p.variants && p.variants.size && p.variants.size.length > 1 ? `
        <div class="pdp-opt">
          <div class="t-eyebrow">Size</div>
          <div class="pdp-sizes" data-sizes>
            ${p.variants.size.map((s) => `
              <button type="button" class="chip${s.id === sel.size ? ' on' : ''}"
                data-size="${esc(s.id)}">${esc(s.label)}</button>`).join('')}
          </div>
        </div>` : ''}

      ${out ? notice('bad', '<b>Sold out.</b> We buy in small batches, so this '
            + 'stays out until the next one — usually a few weeks.')
        : low ? notice('warn', `<b>Only ${p.stock} left.</b> The next batch is a few weeks away.`)
        : ''}

      ${p.kind === 'voucher' ? notice('info',
        '<b>Issued by hand.</b> There is no automatic voucher system behind this '
      + 'site. We will email the code once we have confirmed your order, '
      + 'usually the same day.') : ''}

      <div class="pdp-actions">
        ${out ? '' : qtyStepper('pdp', 1, p.kind === 'voucher' ? null : p.stock)}
        <button class="btn btn-primary" data-buy ${out ? 'disabled' : ''}>
          ${out ? 'Sold out' : 'Add to bag'}</button>
        <button class="btn btn-secondary" data-wish="${esc(p.id)}"
          aria-pressed="${wished}">${icon('heart', 16)} ${wished ? 'Saved' : 'Save'}</button>
      </div>

      <div>
        <h2 class="t-h3" style="margin-bottom:var(--s2)">Specifications</h2>
        <dl class="spec">
          ${p.specs.map((s) => `<div class="spec-row">
            <dt>${esc(s.k)}</dt><dd>${esc(s.v)}</dd></div>`).join('')}
        </dl>
      </div>

      <div>
        <h2 class="t-h3" style="margin-bottom:var(--s2)">Delivery and returns</h2>
        <dl class="spec">
          <div class="spec-row"><dt>Arrives</dt>
            <dd>${esc(D.fmtDateRange(est.from, est.to))}
                <span class="dim">(${est.minDays}–${est.maxDays} working
                days)</span></dd></div>
          <div class="spec-row"><dt>Delivery</dt>
            <dd>${shop.shipping.fee
                  ? `${D.rupees(shop.shipping.fee)} flat, free above
                     ${D.rupees(shop.shipping.freeOver)}`
                  : 'Free, anywhere in India'}${p.shipClass === 'bulky'
                  ? `. This is a bulky item: ${D.rupees(shop.shipping.bulkySurcharge)} handling applies.`
                  : ''}</dd></div>
          ${shop.returns && shop.returns.days ? `<div class="spec-row">
            <dt>Returns</dt>
            <!-- ⚠️ The number comes from shop.returns.days, never the word
                 "Seven". DEVI hardcoded it here while its policy page read it
                 from the JSON, so changing the window in one place would have
                 left the product page promising the old one -- on the exact
                 screen where the customer decides. -->
            <dd>${shop.returns.free ? 'Free' : 'At your cost'}, within
                ${shop.returns.days} days of delivery &mdash; wrong size
                included. <a href="#/returns"
                style="color:var(--gold-ink);text-decoration:underline">Read the
                policy</a></dd></div>` : ''}
        </dl>
      </div>
    </div>
  </div>

  ${related.length ? `
    <section class="sec" style="margin-top:var(--s7)">
      <div class="sec-head"><h2 class="t-h2">You may also like</h2></div>
      <div class="grid-products">
        ${related.map((x) => productCard(x, shop, wishIds.includes(x.id))).join('')}
      </div>
    </section>` : ''}`;

  // -------------------------------------------------------------------------
  const $ = (s) => host.querySelector(s);

  function paintColour() {
    const lab = $('[data-colour-label]');
    const sw = $('[data-swatches]');
    if (!sw) return;
    sw.innerHTML = swatchRow(p, sel.colour, false);
    const c = p.variants.colour.find((x) => x.id === sel.colour);
    if (lab) lab.textContent = c ? c.label : '';
    for (const b of sw.querySelectorAll('[data-sw]')) {
      b.addEventListener('click', () => {
        sel.colour = b.dataset.sw;
        // A colour with its own view index shows that view; otherwise the
        // alternate colourway render.
        const cc = p.variants.colour.find((x) => x.id === sel.colour);
        setView(cc && cc.img != null && cc.img < views ? cc.img : 0);
        paintColour();
      });
    }
  }
  paintColour();

  function setView(i) {
    view = i;
    $('[data-main]').innerHTML = art(p, i);
    for (const t of host.querySelectorAll('[data-view]')) {
      t.classList.toggle('on', +t.dataset.view === i);
    }
  }
  for (const t of host.querySelectorAll('[data-view]')) {
    t.addEventListener('click', () => setView(+t.dataset.view));
  }

  for (const b of host.querySelectorAll('[data-size]')) {
    b.addEventListener('click', () => {
      sel.size = b.dataset.size;
      for (const x of host.querySelectorAll('[data-size]')) {
        x.classList.toggle('on', x.dataset.size === sel.size);
      }
      // The price moves with the size, so it has to re-render.
      $('[data-price]').innerHTML = priceBlock(p, sel, true);
    });
  }

  const stepper = $('[data-qty]');
  if (stepper) {
    stepper.addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]');
      if (!b) return;
      const max = p.kind === 'voucher' ? 99 : p.stock;
      qty = Math.max(1, Math.min(max, qty + Number(b.dataset.step)));
      stepper.querySelector('.qty-val').textContent = qty;
      stepper.querySelector('[data-step="-1"]').disabled = qty <= 1;
      stepper.querySelector('[data-step="1"]').disabled = qty >= max;
    });
  }

  const buy = $('[data-buy]');
  if (buy && !out) {
    buy.addEventListener('click', async () => {
      await store.cart.add(p.id, qty, { ...sel });
      const label = D.variantLabel(p, sel);
      toast(`${p.name}${label ? ' · ' + label : ''} added to your bag`);
    });
  }
});
