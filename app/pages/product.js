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
import { esc, crumbs, toast, emptyState, notice, openSheet, flyToBag } from '../ui.js';
import { priceBlock, swatchRow, productCard,
         sizeChart, fitHint, chartFor } from '../components.js';
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
  //
  // ⚠️ NO SIZE until one is tapped (7 November 2026). The first size used to
  // come preselected, so Add to bag put an S in the bag for anyone who never
  // looked at the sizes -- the same return the cards used to cause. A product
  // with a single size has nothing to choose, and gets it.
  //
  // ⚠️ WHAT IS IN THE BAG ALREADY decides where the page opens (8 November
  // 2026, the owner: "if I had added 2-3 initially, it should show that").
  // The newest line of this product in the bag -- its colour and its size --
  // is the one selected, so the bar under the sizes reads "M · 3 in bag",
  // as the card did. Nothing in the bag, and the rule above holds: no size.
  const sizes = (p.variants && p.variants.size) || [];
  const colours = (p.variants && p.variants.colour) || [];
  const last = [...(await store.cart.lines())].reverse().find((l) => l.pid === p.id);
  const lastV = (last && last.variant) || {};
  const sel = {
    colour: colours.some((c) => c.id === lastV.colour) ? lastV.colour
      : (colours.length ? colours[0].id : null),
    size: sizes.some((s) => s.id === lastV.size) ? lastV.size
      : (sizes.length === 1 ? sizes[0].id : null),
  };

  const badges = D.derivedBadges(p, shop);
  const out = badges.includes('sold-out');
  const low = badges.includes('low-stock');
  const views = viewCount(p);
  // The photograph of the colour selected: a colour opened from the bag
  // shows itself, not the first colour.
  const colourView = (id) => {
    const c = colours.find((x) => x.id === id);
    return c && c.img != null && c.img < views ? c.img : 0;
  };
  let view = colourView(sel.colour);
  const max = p.kind === 'voucher' ? 99 : p.stock;

  // ⚠️ An ESTIMATE, computed live, and that is correct HERE and nowhere else.
  // This screen answers "if I order today, when does it arrive" — a question
  // whose answer must move as today moves. The ORDER's estimate is a different
  // thing: it is the promise that was made, it is frozen into the order at
  // placement, and it is read back rather than recomputed. Confusing the two
  // is how a customer's delivery date quietly slides a day every day.
  const est = D.deliveryEstimate(shop.shipping);

  // No chart means no link, rather than a link onto an empty panel. data.pl
  // already fails on a product that sells sizes with no chart behind them, so
  // this branch only fires on a tree where the checks were never run.
  const chart = chartFor(p, shop);

  /** The line under the sizes: how the chosen size fits, or a request for one. */
  const hintFor = (size) => (size ? fitHint(p, shop, size)
    : `Pick your size${chart ? ' to see how it fits' : ''}.`);

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
      <div class="pdp-main" data-main>${art(p, view)}</div>
      <div class="pdp-thumbs">
        ${Array.from({ length: views }, (_, i) => `
          <button type="button" class="pdp-thumb${i === view ? ' on' : ''}"
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
          <div class="t-eyebrow sc-row">
            <span>Size</span>
            ${chart ? `<button type="button" class="sc-link" data-sizeguide>
              ${icon('ruler', 14)} Size chart</button>` : ''}
          </div>
          <div class="pdp-sizes" data-sizes>
            ${p.variants.size.map((s) => `
              <button type="button" class="chip${s.id === sel.size ? ' on' : ''}"
                data-size="${esc(s.id)}">${esc(s.label)}</button>`).join('')}
          </div>
          <!-- ⚠️ The fit hint, not the table, is the thing most people read.
               It costs no taps and sits beside the size they just chose.
               Before a size is chosen it asks for one, and Add to bag with
               none chosen says so here, where the eye already is. -->
          <p class="sc-hint" data-fithint aria-live="polite">${hintFor(sel.size)}</p>
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
        <!-- Add to bag, and the − n + it becomes: the card's bar at full
             size (8 November 2026). It replaced a quantity box beside the
             button, which knew nothing of what was already in the bag. -->
        <div class="pdp-cta" data-pdp-cta></div>
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
                 "Seven". Typed in here while the policy page reads the JSON, a
                 change to the window in one place would leave the product page
                 promising the old one -- on the exact
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
        setView(colourView(sel.colour));
        paintColour();
        paintCta();
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
      // ⚠️ So does the fit hint. A hint left reading "fits a 38 in chest"
      // under a highlighted XXL is worse than no hint: it is a wrong
      // measurement shown at the exact moment of the decision.
      const fh = host.querySelector('[data-fithint]');
      if (fh) {
        fh.innerHTML = hintFor(sel.size);
        fh.classList.remove('sc-need');
      }
      // This size may be in the bag already, or not: the bar or the button.
      paintCta();
    });
  }

  // The size guide. Built on OPEN, not with the page, so the row it
  // highlights is the size selected now rather than the one selected when
  // the screen rendered.
  const guide = host.querySelector('[data-sizeguide]');
  if (guide) {
    guide.addEventListener('click', () => {
      openSheet(`Size chart — ${chart.label || p.name}`,
                sizeChart(p, shop, sel.size));
    });
  }

  // -------------------------------------------------------------------------
  // ADD TO BAG, AND THE BAR IT BECOMES -- the card's process at full size (8
  // November 2026, the owner: "the same process as the main screen"). Add to
  // bag puts ONE of the colour and size selected in the bag, and turns into
  // − M · 1 in bag +; + is one more, − one fewer, and at none the button is
  // back. Each one in flies to the bag. The bar shows the line for what is
  // selected NOW, read from the bag on every change -- a size picked that is
  // already in the bag shows its count at once.
  // -------------------------------------------------------------------------
  const variant = () => {
    const v = {};
    if (sel.colour) v.colour = sel.colour;
    if (sel.size) v.size = sel.size;
    return v;
  };
  const keyNow = () => D.lineKey({ pid: p.id, variant: variant() });
  const fullTitle = (n) => (n >= max ? `Only ${max} in stock` : '');

  function ctaHtml(line) {
    if (out) return '<button class="btn btn-primary btn-block" disabled>Sold out</button>';
    if (!line) return '<button type="button" class="btn btn-primary btn-block" data-buy>Add to bag</button>';
    const s = sizes.length > 1 ? sizes.find((x) => x.id === sel.size) : null;
    return `<div class="bag-step bag-step-lg" role="group" data-pdp-line="${esc(keyNow())}"
        aria-label="In your bag${s ? `, size ${esc(s.label)}` : ''}">
      <button type="button" data-pdp-less aria-label="One fewer">${icon('minus', 18)}</button>
      <span class="bag-step-n" aria-live="polite">${s ? `<b>${esc(s.label)}</b> · ` : ''}<span
        data-n>${line.qty}</span> in bag</span>
      <button type="button" data-pdp-more aria-label="One more" title="${fullTitle(line.qty)}"
        ${line.qty >= max ? 'disabled' : ''}>${icon('plus', 18)}</button>
    </div>`;
  }

  /** Repaint the button or the bar from the bag. The same line keeps its bar
   *  and changes only the number, so the button just pressed keeps focus and
   *  a second quick tap still lands on it (as paintCtas does for a card). */
  async function paintCta() {
    const box = $('[data-pdp-cta]');
    if (!box || !box.isConnected) return;
    const key = keyNow();
    const line = (await store.cart.lines()).find((l) => D.lineKey(l) === key);
    if (key !== keyNow()) return;          // the selection moved while reading
    const step = box.querySelector('.bag-step');
    if (line && step && step.dataset.pdpLine === key) {
      step.querySelector('[data-n]').textContent = line.qty;
      const more = step.querySelector('[data-pdp-more]');
      more.disabled = line.qty >= max;
      more.title = fullTitle(line.qty);
      return;
    }
    if (!line && !step && box.firstElementChild) return;
    const had = box.contains(document.activeElement);
    box.innerHTML = ctaHtml(line);
    const next = box.querySelector('[data-pdp-more]:not(:disabled), [data-buy]')
      || box.querySelector('[data-pdp-less]');
    if (had && next) next.focus();
  }
  await paintCta();
  router.onLeave(store.live.subscribe('cart', paintCta));

  /** One in: the flight first -- it holds the bag's count until the photo
   *  lands -- then the add, then the message naming the colour and size. */
  async function addOne(btn) {
    const v = variant();
    flyToBag($('[data-main]'), 1, btn);
    await store.cart.add(p.id, 1, v);
    const label = D.variantLabel(p, v);
    toast(`${p.name}${label ? ' · ' + label : ''} added to your bag`);
  }

  $('[data-pdp-cta]').addEventListener('click', async (e) => {
    if (out) return;
    const buy = e.target.closest('[data-buy]');
    const more = e.target.closest('[data-pdp-more]');
    const less = e.target.closest('[data-pdp-less]');
    if (buy) {
      if (!sel.size && sizes.length > 1) {
        // Nothing goes in the bag. The request sits under the sizes, and the
        // focus goes to the first of them, so a keyboard can answer it at once.
        const fh = $('[data-fithint]');
        if (fh) {
          fh.innerHTML = '<b>Pick a size first.</b> Nothing has gone in your bag yet.';
          fh.classList.add('sc-need');
        }
        const first = $('[data-size]');
        if (first) first.focus();
        return;
      }
      await addOne(buy);
      return;
    }
    // + and − read the bag itself, not the number on the bar, which a second
    // tab or a second quick tap may have moved.
    if (more || less) {
      const key = keyNow();
      const line = (await store.cart.lines()).find((l) => D.lineKey(l) === key);
      if (more) {
        if (!line || line.qty < max) await addOne(more);
      } else if (line) {
        await store.cart.setQty(key, line.qty - 1);
        if (line.qty === 1) toast('Removed from your bag');
      }
    }
  });
});
