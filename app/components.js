// ============================================================================
// DEVI Collections — shared components.
//
// Governing decision: PRODUCTS FLOAT, NOTHING IS BOXED. The card has no
// border, no fill and no shadow; only the image tile has an edge. A bordered
// white rectangle around every tile is the single most recognisable template
// signature, and avoiding it costs nothing.
// ============================================================================

import { esc } from './ui.js';
import { icon, heartFilled } from './icons.js';
import { art } from './art.js';
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
// PRODUCT CARD
// ---------------------------------------------------------------------------
export function productCard(p, shop, wished) {
  const d = D.derivedBadges(p, shop);
  const out = d.includes('sold-out');
  const href = `#/p/${p.slug}`;
  const wishLabel = wished ? 'Saved to wishlist' : 'Save to wishlist';
  const cta = out
    ? '<button class="btn btn-secondary btn-sm btn-block" disabled>Sold out</button>'
    : `<button class="btn btn-secondary btn-sm btn-block" data-add="${esc(p.id)}">Add to bag</button>`;

  return `<article class="card" data-pid="${esc(p.id)}">
  <a class="card-tile" href="${href}" aria-label="${esc(p.name)}">
    ${tileBadge(p, shop)}
    <div class="card-art" data-art>${art(p, 0)}</div>
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
    ${swatchRow(p, null)}
    <div>${cta}</div>
  </div>
</article>`;
}

export const productGrid = (list, shop, wishIds) =>
  '<div class="grid-products">'
  + list.map((p) => productCard(p, shop, wishIds.includes(p.id))).join('')
  + '</div>';

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
