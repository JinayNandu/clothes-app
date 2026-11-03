// ============================================================================
// DEVI Collections — the shell. Header, drawer, toast, counts.
//
// ⚠️ THIS MODULE MUST NEVER IMPORT A PAGE MODULE. Pages import it. The import
// graph has to stay a tree: a cycle hands you `undefined` for something that
// looks hoisted and throws at render, and the stack trace points somewhere
// unrelated. tools/routes.pl greps for it because no bracket checker can.
// ============================================================================

import * as store from './store.js';
import { icon } from './icons.js';
import { logo, mark, brandBand } from './brand.js';

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** ⚠️ Everything interpolated into innerHTML goes through this. A product name
 *  with an ampersand is not an attack, but it is a broken page. */
export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const mount = (el, html) => { el.innerHTML = html; return el; };

// ---------------------------------------------------------------------------
// TOAST
// ---------------------------------------------------------------------------
let toastEl = null, toastT = null;
export function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------------------
// HEADER COUNTS — subscribed once, at boot, and never torn down.
// ---------------------------------------------------------------------------
export async function refreshCounts() {
  const n = await store.cart.count();
  const w = (await store.wishlist.ids()).length;
  for (const el of $$('[data-cart-count]')) {
    el.textContent = n;
    el.hidden = n === 0;
  }
  for (const el of $$('[data-wish-count]')) {
    el.textContent = w;
    el.hidden = w === 0;
  }
}

// ---------------------------------------------------------------------------
// THE MOBILE DRAWER
//
// `inert` on everything behind it: without that, a swipe or a Tab walks into
// the page under the scrim and focus disappears somewhere invisible.
// ---------------------------------------------------------------------------
let lastFocus = null;

export function openDrawer() {
  const d = $('#drawer'), s = $('#scrim');
  if (!d) return;
  lastFocus = document.activeElement;
  d.classList.add('open');
  s.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  $('#shell').inert = true;
  $('#site-header').inert = true;
  const first = d.querySelector('button, a');
  if (first) first.focus();
}

export function closeDrawer() {
  const d = $('#drawer'), s = $('#scrim');
  if (!d) return;
  d.classList.remove('open');
  s.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  $('#shell').inert = false;
  $('#site-header').inert = false;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

// ---------------------------------------------------------------------------
// SHARED FRAGMENTS
// ---------------------------------------------------------------------------
export const h1 = (title, eyebrow, sub) => `
  <div class="page-head">
    ${eyebrow ? `<div class="t-eyebrow">${esc(eyebrow)}</div>` : ''}
    <h1 class="t-h1">${esc(title)}</h1>
    ${sub ? `<p>${esc(sub)}</p>` : ''}
  </div>`;

export const emptyState = (sealSvg, head, body, ctaLabel, ctaHref) => `
  <div class="empty">
    <span class="seal">${sealSvg}</span>
    <h2 class="t-h3">${esc(head)}</h2>
    <p>${esc(body)}</p>
    ${ctaLabel ? `<a class="btn btn-primary" href="${ctaHref}">${esc(ctaLabel)}</a>` : ''}
  </div>`;

export const notice = (tone, html) => `
  <div class="notice notice-${tone}">
    ${icon(tone === 'warn' || tone === 'bad' ? 'warn' : 'info', 18)}
    <div>${html}</div>
  </div>`;

export const crumbs = (parts) => `
  <nav class="crumbs" aria-label="Breadcrumb">
    ${parts.map((p, i) => (p.href
      ? `<a href="${p.href}">${esc(p.label)}</a>`
      : `<span aria-current="page">${esc(p.label)}</span>`)
      + (i < parts.length - 1 ? '<span class="sep">/</span>' : '')).join('')}
  </nav>`;

// ---------------------------------------------------------------------------
// BOOT — the header and the footer, drawn once.
// ---------------------------------------------------------------------------
export function drawChrome(shop) {
  // The monogram ALONE in the sticky row. The full lockup lives in the band
  // above it, and two lockups stacked at the top of the page read as a
  // mistake rather than as emphasis.
  $('#brand-logo').innerHTML = mark(26);
  const band = $('#brand-band');
  if (band) band.innerHTML = brandBand(shop);

  for (const [sel, name] of [['#i-search', 'search'], ['#i-wish', 'heart'],
                             ['#i-bag', 'bag'], ['#i-burger', 'menu'],
                             ['#i-search-m', 'search'], ['#i-close', 'close']]) {
    const el = $(sel);
    if (el) el.innerHTML = icon(name, 20);
  }

  const strip = $('#strip');
  if (strip) {
    strip.innerHTML = `Complimentary shipping on orders above `
      + `<b>₹${shop.shipping.freeOver.toLocaleString('en-IN')}</b>`
      + ` &nbsp;·&nbsp; Dispatched in ${esc(shop.shipping.shipsIn)}`;
  }
}
