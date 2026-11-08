// ============================================================================
// Vastra Apparel — shared components.
//
// Governing decision: PRODUCTS FLOAT, NOTHING IS BOXED. The card has no
// border, no fill and no shadow; only the image tile has an edge. A bordered
// white rectangle around every tile is the single most recognisable template
// signature, and avoiding it costs nothing.
// ============================================================================

import { esc } from './ui.js';
import { icon, heartFilled } from './icons.js';
import { art, viewCount } from './art.js';
import * as D from './domain.js';

// ---------------------------------------------------------------------------
// PRICE BLOCK
// ⚠️ If price === mrp the price renders ALONE: no "−0%", no empty
// strikethrough, no badge. Several products legitimately sit at MRP, and
// showing a saving that does not exist is worse than showing none at all.
// ---------------------------------------------------------------------------
export function priceBlock(p, sel, big) {
  const now = D.variantPrice(p, sel);
  const mrp = D.variantMrp(p, sel);
  const off = D.discountPct(p);
  const cls = 'price' + (big ? ' price-lg' : '');
  if (mrp <= now) {
    return `<div class="${cls}"><span class="price-now">${D.rupees(now)}</span></div>`;
  }
  return `<div class="${cls}">
    <span class="price-now">${D.rupees(now)}</span>
    <span class="price-mrp">${D.rupees(mrp)}</span>
    <span class="price-off">&minus;${off}%</span>
  </div>`;
}

// ---------------------------------------------------------------------------
// SWATCHES
// ⚠️ `swatch` is a literal hex from catalog.json and is the one permitted
// literal colour in this project. It is product DATA — a real fabric colour —
// and not theme; there is no token that could describe "madder red". It is
// interpolated from the data and never written in source, which is why
// tools/art.pl still fails on a hex typed into a module.
// ---------------------------------------------------------------------------
export function swatchRow(p, selected, small = true) {
  const cols = (p.variants && p.variants.colour) || [];
  if (cols.length < 2) return '';
  const show = small ? cols.slice(0, 5) : cols;
  const more = small && cols.length > 5 ? cols.length - 5 : 0;
  const dots = show.map((c) => {
    const on = c.id === selected ? ' on' : '';
    const size = small ? '' : ' sw-lg';
    return `<button type="button" class="sw${size}${on}"
      style="background:${esc(c.swatch)}" data-sw="${esc(c.id)}"
      title="${esc(c.label)}" aria-label="${esc(c.label)}"
      aria-pressed="${c.id === selected}"></button>`;
  }).join('');
  const plus = more ? `<span class="sw-more">+${more}</span>` : '';
  return `<div class="swatches" role="group" aria-label="Colours">${dots}${plus}</div>`;
}

// ---------------------------------------------------------------------------
// BADGES — always derived, never read from the stored array.
// ---------------------------------------------------------------------------
function tileBadge(p, shop) {
  const d = D.derivedBadges(p, shop);
  if (d.includes('sold-out')) return '';
  if (d.includes('sale')) {
    return `<span class="badge-sale">&minus;${D.discountPct(p)}%</span>`;
  }
  if (d.includes('new')) return '<span class="badge-soft">New</span>';
  return '';
}

// ---------------------------------------------------------------------------
// THE CARD'S BUTTON: Add to bag -> a size -> − M · n +.
//
// ⚠️ A GARMENT IS NEVER ADDED IN A SIZE NOBODY CHOSE. On a product with more
// than one size, Add to bag opens the size panel (sizePanel, below; app.js
// opens and closes it) and only a size somebody tapped goes in the bag. It
// used to add the first size, S, without asking: a return waiting to happen,
// and the − n + made three of them three taps.
//
// After that a card counts ONE line: this product, in the colour the card
// shows, in the size added LAST -- the newest such line in the bag, so the
// size just tapped is the size on the bar. − takes one of that size off; at
// none, Add to bag comes back. A second size is the product page's job.
//
// `bag` is the bag as last read, in bag order. app.js sets it at boot and on
// every change, so a card drawn by ANY screen comes out in the right state
// without each page reading the bag, and paintCtas() moves the cards already
// on screen without redrawing them.
// ---------------------------------------------------------------------------
let bag = [];
export function setBag(lines) { bag = lines; }

// Every product a card was drawn for, by id: paintCtas() needs the stock of
// the colour and size a card's line is in (8 November 2026), and the card
// on screen is the one that knows which product it is.
const known = new Map();

/** How many of this line there can be: its colour in its size, and never
 *  more than an order takes (D.lineMax). */
const lineMax = (pid, line) => {
  const p = known.get(pid);
  return p && line ? D.lineMax(p, line.variant) : 0;
};
/** Why the + stopped: the stock, or the order's limit (D.fullTitle). */
const fullTitle = (pid, line) => {
  const p = known.get(pid);
  return p && line ? D.fullTitle(line.qty, p, line.variant) : '';
};

const sizesOf = (p) => (p && p.variants && p.variants.size) || [];

/** The line a card counts: the newest one of this product in this colour. */
function cardLine(pid, colour) {
  for (let i = bag.length - 1; i >= 0; i -= 1) {
    const l = bag[i];
    if (l.pid === pid && ((l.variant && l.variant.colour) || '') === colour) return l;
  }
  return null;
}

/** `labels` is { sizeId: label }, and empty for a product with one size or
 *  none: there is nothing to choose, so nothing to name and no panel. */
function ctaInner(pid, line, max, labels) {
  const asks = Object.keys(labels).length > 1;
  if (!line) {
    return `<button class="btn btn-secondary btn-sm btn-block" data-add="${esc(pid)}"
      ${asks ? 'aria-expanded="false"' : ''}>Add to bag</button>`;
  }
  const size = labels[(line.variant && line.variant.size) || ''] || '';
  return `<div class="bag-step" role="group" data-line="${esc(D.lineKey(line))}"
      aria-label="In your bag${size ? `, size ${esc(size)}` : ''}">
    <button type="button" data-less aria-label="One fewer">${icon('minus', 16)}</button>
    <span class="bag-step-n" aria-live="polite">${size ? `<b>${esc(size)}</b> · ` : ''}<span
      data-n>${line.qty}</span><span class="bag-step-word"> in bag</span></span>
    <button type="button" data-more aria-label="One more" title="${fullTitle(pid, line)}"
      ${line.qty >= max ? 'disabled' : ''}>${icon('plus', 16)}</button>
  </div>`;
}

const labelsOf = (box) => (box.dataset.sizes ? JSON.parse(box.dataset.sizes) : {});

export function paintCtas(root = document) {
  for (const box of root.querySelectorAll('[data-cta]')) {
    const line = cardLine(box.dataset.cta, box.dataset.colour || '');
    const max = lineMax(box.dataset.cta, line);
    const step = box.querySelector('.bag-step');
    if (line && step && step.dataset.line === D.lineKey(line)) {
      // The same line: the number and nothing else, so the button just
      // pressed keeps focus and a second quick tap still lands on it.
      const more = step.querySelector('[data-more]');
      step.querySelector('[data-n]').textContent = line.qty;
      more.disabled = line.qty >= max;
      more.title = fullTitle(box.dataset.cta, line);
      continue;
    }
    if (!line && !step) continue;
    // Button <-> bar, or the bar onto another size. Focus follows, or a
    // keyboard user is left on a button that no longer exists.
    const had = box.contains(document.activeElement);
    box.innerHTML = ctaInner(box.dataset.cta, line, max, labelsOf(box));
    const next = box.querySelector('[data-more]:not(:disabled), [data-add]')
      || box.querySelector('[data-less]');
    if (had && next) next.focus();
  }
}

/** The panel a card's Add to bag opens on a product with sizes. Each chip
 *  names its size and, where it costs more, how much more: the card shows
 *  the S price, and XL is ₹50 over it because it takes more cloth. The fit
 *  line ("Fits a 40 in chest") rides on each chip as its tooltip. A size
 *  with none left in the colour the card shows is struck through and cannot
 *  be picked (8 November 2026: stock is kept by colour and size). */
export function sizePanel(p, shop, colour = '') {
  const chart = chartFor(p, shop);
  const chips = sizesOf(p).map((s) => {
    const fit = fitHint(p, shop, s.id).replace(/<[^>]+>/g, '');
    const out = D.skuStock(p, { colour, size: s.id }) === 0;
    return `<button type="button" class="chip${out ? ' is-out' : ''}" data-pick="${esc(s.id)}"
      ${out ? 'disabled' : ''}
      aria-label="Size ${esc(s.label)}${out ? ', sold out' : s.delta ? `, ${D.rupees(s.delta)} more` : ''}"
      ${out ? 'title="Sold out in this colour"' : fit ? `title="${fit}"` : ''}>${esc(s.label)}${out
        ? '<small>Sold out</small>' : s.delta ? `<small>+${D.rupees(s.delta)}</small>` : ''}</button>`;
  }).join('');
  // The size chart is a full-width line of its own under the chips, in words,
  // on every screen. It was an info icon in the corner, with its words only
  // from 600px up -- so on a phone nobody found it (the owner, 8 November 2026).
  return `<div class="card-sizes" data-sizes-panel>
    <div class="card-sizes-panel" role="group" aria-label="Pick a size">
      <div class="card-sizes-head">
        <span class="card-sizes-title">Pick a size</span>
        <button type="button" class="card-sizes-btn" data-sizes-close
          aria-label="Close the sizes">${icon('close', 15)}</button>
      </div>
      <div class="card-sizes-grid">${chips}</div>
      ${chart ? `<button type="button" class="card-sizes-chart" data-sizes-guide>
        ${icon('ruler', 15)} Size chart</button>` : ''}
    </div>
  </div>`;
}

/** A card's colour dot. The photo, the ringed dot and the line the card counts
 *  all move to that colour, so the bag gets the colour on screen. The dots
 *  used to do nothing on a card: tap Turmeric, add, and receive Indigo. */
export function setCardColour(card, p, id) {
  const c = ((p.variants && p.variants.colour) || []).find((x) => x.id === id);
  if (!c) return;
  card.querySelector('[data-art]').innerHTML =
    art(p, c.img != null && c.img < viewCount(p) ? c.img : 0);
  for (const b of card.querySelectorAll('[data-sw]')) {
    b.classList.toggle('on', b.dataset.sw === id);
    b.setAttribute('aria-pressed', String(b.dataset.sw === id));
  }
  const box = card.querySelector('[data-cta]');
  if (box) {
    box.dataset.colour = id;
    paintCtas(card);
  }
}

// ---------------------------------------------------------------------------
// PRODUCT CARD
// ---------------------------------------------------------------------------
export function productCard(p, shop, wished) {
  const d = D.derivedBadges(p, shop);
  const out = d.includes('sold-out');
  const href = `#/p/${p.slug}`;
  const wishLabel = wished ? 'Saved to wishlist' : 'Save to wishlist';
  // The first colour, as the photo shows it, until a dot says otherwise.
  const cols = (p.variants && p.variants.colour) || [];
  const colour = cols.length ? cols[0].id : '';
  const sizes = sizesOf(p);
  const labels = sizes.length > 1 ? Object.fromEntries(sizes.map((s) => [s.id, s.label])) : {};
  known.set(p.id, p);
  const line = cardLine(p.id, colour);
  const cta = out
    // Sold out -- disabled, marked out of stock, or none of any size left: a
    // customer may ask to be told when it is back (notify.js; 9 November 2026).
    ? `<div><button type="button" class="btn btn-secondary btn-sm btn-block" data-notify="${esc(p.id)}"
        aria-label="Notify me when ${esc(p.name)} is back">${icon('mail', 14)} Notify me</button></div>`
    : `<div data-cta="${esc(p.id)}" data-colour="${esc(colour)}"
        ${sizes.length > 1 ? `data-sizes="${esc(JSON.stringify(labels))}"` : ''}>${
      ctaInner(p.id, line, lineMax(p.id, line), labels)}</div>`;

  return `<article class="card" data-pid="${esc(p.id)}">
  <a class="card-tile" href="${href}" aria-label="${esc(p.name)}">
    ${tileBadge(p, shop)}
    <div class="card-art" data-art>${art(p, 0)}</div>
    <span class="rating-badge on-photo" data-rating-for="${esc(p.id)}" aria-hidden="true"
      >${ratingBadge(ratingOf(p.id))}</span>
    ${out ? '<span class="badge-out">Sold out</span>' : ''}
    <span class="quick">View details</span>
  </a>
  <button type="button" class="wish${wished ? ' on' : ''}" data-wish="${esc(p.id)}"
    aria-pressed="${wished}" aria-label="${wishLabel}"
    >${wished ? heartFilled(17) : icon('heart', 17)}</button>
  <div class="card-body">
    <a href="${href}" class="card-name">${esc(p.name)}</a>
    <p class="card-desc">${esc(p.shortDesc)}</p>
    ${priceBlock(p, null)}
    <span class="sr-only" data-rating-for="${esc(p.id)}" data-rating-as="words"
      >${ratingWords(ratingOf(p.id))}</span>
    ${swatchRow(p, colour || null)}
    ${cta}
  </div>
</article>`;
}

// ---------------------------------------------------------------------------
// STARS (8 November 2026) -- ratings out of five. A rating SHOWN fills the
// first Math.round(value) stars; a rating GIVEN is five radios drawn as
// stars, so a keyboard moves through them as through any choice.
//
// `ratings` is every product's { average, ratings } as last read, set by
// app.js once the shop has loaded -- the same pattern as `bag`: a card drawn
// by any screen comes out with its rating, and paintRatings() fills the ones
// already on screen when the numbers arrive. No rating, no badge: a product
// nobody has rated shows nothing, not "0 reviews".
//
// The SUMMARY is a badge -- "4.4 ★ | 12" -- on the bottom-left of a card's
// photo and under the product page's name, the way Indian shops show it
// (the owner sent one: "the review should be visible something like this").
// On a card it is for the eye only: the photo is a link named by the
// product, and that name hides whatever is inside it from a screen reader,
// so the card's text carries the same in words (data-rating-as="words").
// ---------------------------------------------------------------------------
let ratings = {};
export function setRatings(m) { ratings = m || {}; }
export const ratingOf = (pid) => ratings[pid] || null;

export function stars(value, size = 14) {
  const n = Math.round(Number(value) || 0);
  return `<span class="stars" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) =>
    `<span class="star${i <= n ? ' on' : ''}">${icon('star', size)}</span>`).join('')}</span>`;
}

/** "4.4 ★ | 12" ("12 ratings" with `words`), or '' when nobody has rated. */
export function ratingBadge(r, words = false) {
  if (!r || !r.ratings) return '';
  const many = words ? ` ${r.ratings === 1 ? 'rating' : 'ratings'}` : '';
  return `<b>${r.average.toFixed(1)}</b>${icon('star', 11)}<span class="rb-sep"></span>`
    + `<span>${D.fmtCount(r.ratings)}${many}</span>`;
}

/** The badge in words: "Rated 4.4 out of 5 by 12 customers". */
export function ratingWords(r) {
  if (!r || !r.ratings) return '';
  return `Rated ${r.average.toFixed(1)} out of 5 by ${D.fmtInt(r.ratings)} `
    + (r.ratings === 1 ? 'customer' : 'customers');
}

export function paintRatings(root = document) {
  for (const el of root.querySelectorAll('[data-rating-for]')) {
    const r = ratings[el.dataset.ratingFor];
    el.innerHTML = el.dataset.ratingAs === 'words' ? ratingWords(r) : ratingBadge(r);
  }
}

/** Five radios drawn as stars. `name` must be unique in the document. */
export function starsInput(name, value = 0, label = 'Your rating') {
  return `<div class="stars-in" role="radiogroup" aria-label="${esc(label)}">
    ${[1, 2, 3, 4, 5].map((i) => `<label class="star${i <= value ? ' on' : ''}">
      <input type="radio" name="${esc(name)}" value="${i}"${i === value ? ' checked' : ''}
        aria-label="${i} of 5">${icon('star', 30)}</label>`).join('')}
  </div>`;
}

/** Light every star up to the one chosen. Delegated: wire a box once. */
export function wireStars(root) {
  root.addEventListener('change', (e) => {
    const input = e.target.closest('.stars-in input');
    if (!input) return;
    const v = Number(input.value);
    input.closest('.stars-in').querySelectorAll('label')
      .forEach((l, i) => l.classList.toggle('on', i < v));
  });
}

export const productGrid = (list, shop, wishIds) =>
  '<div class="grid-products">'
  + list.map((p) => productCard(p, shop, wishIds.includes(p.id))).join('')
  + '</div>';

// ---------------------------------------------------------------------------
// THE ORDER'S CHAIN — Ordered, Confirmed, Packed, Shipped, Delivered, left to
// right, green up to where the order is (8 November 2026, the owner's ask: "the
// shipping chain … highlighting the part that is done, to see real time
// status"). On the order's own page with words under each step, and small on
// every order in Your orders. Built from D.trackSteps(), so it can never
// disagree with the timeline under it -- and an order the store stepped back
// is drawn where it is now, not where it once got to.
// ---------------------------------------------------------------------------
const CHAIN_WORD = {
  draft: 'Saved', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped',
  delivered: 'Delivered', returned: 'Returned', cancelled: 'Cancelled', abandoned: 'Closed',
};

export function orderChain(o, small = false) {
  const steps = D.trackSteps(o);
  const word = (s) => (s === 'sent' ? (o.sentVia === 'online' ? 'Ordered' : 'Sent')
    : s === 'abandoned' && o.sentVia === 'online' ? 'Cancelled' : CHAIN_WORD[s]);
  const now = steps.find((s) => s.state === 'now' || s.state === 'end')
    || [...steps].reverse().find((s) => s.state === 'done');
  return `<ol class="chain${small ? ' chain-sm' : ''}" aria-label="Where this order is: ${esc(
    now ? word(now.status) : '')}">
    ${steps.map((s) => `<li class="is-${s.state}"${s === now ? ' aria-current="step"' : ''}>
      <span class="chain-dot" aria-hidden="true">${s.state === 'done' ? icon('check', 11)
        : s.state === 'end' ? icon('close', 10) : ''}</span>
      <span class="chain-l">${esc(word(s.status))}</span>
    </li>`).join('')}
  </ol>`;
}

// ---------------------------------------------------------------------------
// QUANTITY STEPPER
// ---------------------------------------------------------------------------
export const qtyStepper = (key, qty, max) => `
  <div class="qty" data-qty="${esc(key)}">
    <button type="button" data-step="-1" aria-label="Reduce quantity"
      ${qty <= 1 ? 'disabled' : ''}>${icon('minus', 16)}</button>
    <span class="qty-val" aria-live="polite">${qty}</span>
    <button type="button" data-step="1" aria-label="Increase quantity"
      ${max != null && qty >= max ? 'disabled' : ''}>${icon('plus', 16)}</button>
  </div>`;

// ---------------------------------------------------------------------------
// A MERCHANDISING RAIL
// ---------------------------------------------------------------------------
export function rail(id, title, list, shop, wishIds, href) {
  if (!list.length) return '';
  const all = href ? `<a class="btn-ghost" href="${href}">View all</a>` : '';
  return `<section class="sec">
  <div class="sec-head">
    <h2 class="t-h2">${esc(title)}</h2>
    ${all}
  </div>
  <div class="rail-wrap">
    <div class="rail-scroll" id="${esc(id)}">
      ${list.map((p) => productCard(p, shop, wishIds.includes(p.id))).join('')}
    </div>
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// FORM FIELD
// Every field states whether it is required. A form where some fields are
// marked and others say nothing makes the reader guess which is which.
// ---------------------------------------------------------------------------
export function field(name, label, opts = {}) {
  const {
    type = 'text', required = false, value = '', placeholder = '',
    span = false, options = null, rows = 0, inputmode = '', maxlength = 0,
  } = opts;
  const id = 'f-' + name;
  const mark = required
    ? ' <span class="req" aria-hidden="true">*</span>'
    : ' <span class="opt">(optional)</span>';
  const lab = `<label for="${id}">${esc(label)}${mark}</label>`;

  let control;
  if (options) {
    const opts2 = options.map((o) =>
      `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('');
    control = `<div class="select-wrap">
      <select id="${id}" name="${esc(name)}"${required ? ' required' : ''}>
        <option value="">Select&hellip;</option>${opts2}
      </select><span class="chev">${icon('down', 16)}</span></div>`;
  } else if (rows) {
    control = `<textarea id="${id}" name="${esc(name)}" rows="${rows}"
      placeholder="${esc(placeholder)}"${required ? ' required' : ''}>${esc(value)}</textarea>`;
  } else {
    control = `<input id="${id}" name="${esc(name)}" type="${esc(type)}"
      value="${esc(value)}" placeholder="${esc(placeholder)}"
      ${inputmode ? `inputmode="${esc(inputmode)}"` : ''}
      ${maxlength ? `maxlength="${maxlength}"` : ''}
      ${required ? 'required' : ''}>`;
  }

  return `<div class="field${span ? ' span2' : ''}" data-field="${esc(name)}">
    ${lab}${control}
    <div class="field-err" data-err hidden></div>
  </div>`;
}

export function setFieldError(root, name, message) {
  const f = root.querySelector(`[data-field="${name}"]`);
  if (!f) return;
  const e = f.querySelector('[data-err]');
  if (message) {
    f.classList.add('bad');
    e.innerHTML = icon('warn', 14) + '<span>' + esc(message) + '</span>';
    e.hidden = false;
  } else {
    f.classList.remove('bad');
    e.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// THE SIZE CHART
//
// ⚠️ THIS IS THE CHEAPEST RETURN PREVENTION IN THE PROJECT. Most clothing
// returns are a fit problem, a fit problem is usually a chart problem, and a
// return on a kurti this shop delivers free costs it the courier BOTH ways.
// Every decision below is about getting the right number read, not about the
// table looking tidy.
//
// Three of them are worth stating:
//
// 1. THE SELECTED SIZE IS HIGHLIGHTED. A customer opening this has already
//    tapped a size; the question they are actually asking is "is M right for
//    me", not "what are all five". Making them find their own row in a
//    five-row table is where attention is lost.
//
// 2. EVERY COLUMN SAYS WHETHER IT IS THE BODY OR THE GARMENT. "To fit chest
//    40" means the shirt fits a 40 in chest; the shirt itself measures more,
//    because it needs ease to be wearable. A customer who measures a shirt
//    they already own against a body column reads every size as too small and
//    orders one up. That is a return caused by the chart.
//
// 3. IT RENDERS NOTHING RATHER THAN A BROKEN TABLE. A missing chart returns
//    '' and the caller shows no link at all. data.pl already fails on a
//    missing or incomplete chart, so reaching the empty branch means the
//    checks were not run -- and a half-drawn table of measurements is far
//    worse than no table, because it is still believed.
// ---------------------------------------------------------------------------

/** The chart a product points at, or null. */
export const chartFor = (p, shop) =>
  (p && p.sizeChart && shop && shop.sizeCharts && shop.sizeCharts[p.sizeChart]) || null;

export function sizeChart(p, shop, selectedSize) {
  const ch = chartFor(p, shop);
  const sizes = (p.variants && p.variants.size) || [];
  if (!ch || !sizes.length) return '';

  const cols = ch.cols || [];
  const notes = (shop && shop.measureNotes) || {};
  const unit = ch.unit || 'in';

  const head = cols.map((c) => {
    const n = notes[c] || {};
    return `<th scope="col">${esc(c)}
      ${n.on ? `<span class="sc-on">${esc(n.on)}</span>` : ''}</th>`;
  }).join('');

  const body = sizes.map((s) => {
    const row = ch.rows && ch.rows[s.id];
    if (!row) return '';
    const on = s.id === selectedSize;
    return `<tr${on ? ' class="on"' : ''}>
      <th scope="row">${esc(s.label)}${on
        ? ' <span class="sc-you">your size</span>' : ''}</th>
      ${row.map((v) => `<td>${esc(String(v))}</td>`).join('')}
    </tr>`;
  }).join('');

  // Only the columns this chart actually uses, in its own order. A shared
  // how-to-measure list would otherwise explain a hip measurement on a shirt.
  const how = cols.filter((c) => notes[c] && notes[c].how).map((c) => `
    <li><b>${esc(c)}</b> ${esc(notes[c].how)}</li>`).join('');

  // One line that says how to read the table, from its own first column:
  // "Measure your chest, and find it under To fit chest: that row is your
  // size." Only where the chart keeps the to-fit-first convention.
  const first = cols[0] || '';
  const intro = /^to fit /i.test(first)
    ? `<p class="sc-intro">Measure your <b>${esc(first.replace(/^to fit\s*/i, ''))}</b> and
        find it under <b>${esc(first)}</b>: that row is your size.</p>` : '';

  return `
    ${intro}
    <div class="sc-wrap">
      <table class="sc">
        <caption class="sc-cap">All measurements in ${esc(unit === 'in'
          ? 'inches' : unit)}</caption>
        <thead><tr><th scope="col">Size</th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${ch.fit ? `<p class="sc-fit">${icon('info', 15)}
      <span>${esc(ch.fit)}</span></p>` : ''}
    ${how ? `<h3 class="t-h3 sc-h">How to measure</h3>
      <ul class="sc-how">${how}</ul>` : ''}
    <p class="sc-warn">${icon('warn', 15)}
      <span>These are a standard grading, not a promise to the half inch.
      A finished garment is allowed to vary from the table by about half an
      inch either way.</span></p>`;
}

/** The one-line hint that sits under the size picker, costing no taps at all.
 *
 *  ⚠️ This matters more than the table does. Most people never open a size
 *  guide; the number that changes a decision is the one already on screen
 *  beside the size they just tapped. The table is for the ones who look.
 *
 *  Reads the FIRST column, which is the "to fit" one by convention in every
 *  chart here. Returns '' if that convention is ever broken, rather than
 *  confidently printing a sleeve length as a chest. */
export function fitHint(p, shop, selectedSize) {
  const ch = chartFor(p, shop);
  if (!ch || !selectedSize) return '';
  const col = (ch.cols || [])[0] || '';
  const row = ch.rows && ch.rows[selectedSize];
  if (!row || !row.length || !/^to fit /i.test(col)) return '';
  const what = col.replace(/^to fit\s*/i, '');
  return `Fits a <b>${esc(String(row[0]))} ${esc(ch.unit || 'in')}</b> `
       + `${esc(what)}`;
}
