// ============================================================================
// Vastra Apparel — the shell. Header, drawer, toast, counts.
//
// ⚠️ THIS MODULE MUST NEVER IMPORT A PAGE MODULE. Pages import it. The import
// graph has to stay a tree: a cycle hands you `undefined` for something that
// looks hoisted and throws at render, and the stack trace points somewhere
// unrelated. tools/routes.pl greps for it because no bracket checker can.
// ============================================================================

import * as store from './store.js';
import { icon } from './icons.js';
import { logo, mark, brandBand } from './brand.js';
// domain.js is PURE and imports nothing, so this cannot create a cycle --
// the rule is that ui.js must never import a PAGE.
import * as D from './domain.js';

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
// THE SHEET — a modal panel that belongs to the page, not to the router.
//
// Same discipline as the drawer above, and for the same reasons: `inert` on
// everything behind it, the scrim, the body scroll lock, and focus put back
// where it came from. A modal that leaves focus loose behind its own scrim is
// a modal a keyboard or a screen reader walks straight out of, invisibly.
//
// ⚠️ The close handlers are wired ONCE, on first open, not in app.js. app.js
// is the only module that knows every screen exists; the sheet is reached
// from a page, and a page cannot reach into app.js to ask for wiring. Binding
// them here keeps the sheet self-contained — and the `wired` flag is what
// stops a second open from stacking a second Escape listener, which would
// close the sheet, then immediately try to close it again.
// ---------------------------------------------------------------------------
let sheetFocus = null;
let sheetWired = false;

export function openSheet(title, html) {
  const sh = $('#sheet'), sc = $('#sheet-scrim');
  if (!sh) return;

  if (!sheetWired) {
    sheetWired = true;
    $('#sheet-close').addEventListener('click', closeSheet);
    sc.addEventListener('click', closeSheet);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sh.hidden) closeSheet();
    });
  }

  sheetFocus = document.activeElement;
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;

  // `hidden` off first, then a FORCED REFLOW, then the class — all in this
  // tick. The reflow is what makes the transition animate: it flushes the
  // closed state to the style system, so adding `.open` immediately after is
  // a change the browser has something to interpolate from. Without it the
  // element goes display:none -> open in one paint and simply appears.
  //
  // ⚠️ This was requestAnimationFrame, which is the usual advice and is
  // WRONG HERE. rAF callbacks are suspended whenever a document is not being
  // painted — a background tab, an offscreen frame, some embedded webviews —
  // and the failure is the worst kind available: `hidden` is already off and
  // the shell is already inert, so the page freezes behind a modal that never
  // becomes visible. Nothing to click, nothing to scroll, nothing to see.
  // Measured in this project's own browser pane, where rAF never fires at
  // all: the sheet opened at opacity 0 and locked the page behind it.
  sh.hidden = false; sc.hidden = false;
  void sh.offsetHeight;
  sh.classList.add('open'); sc.classList.add('open');

  sh.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  $('#shell').inert = true;
  $('#site-header').inert = true;
  $('#sheet-close').focus();
}

export function closeSheet() {
  const sh = $('#sheet'), sc = $('#sheet-scrim');
  if (!sh || sh.hidden) return;
  sh.classList.remove('open'); sc.classList.remove('open');
  sh.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  $('#shell').inert = false;
  $('#site-header').inert = false;
  if (sheetFocus && sheetFocus.focus) sheetFocus.focus();

  // ⚠️ `hidden` goes back on only after the transition, or the panel vanishes
  // instead of sliding away. Guarded on the class, because a reopen during
  // those 320ms would otherwise be hidden by its own predecessor's timer.
  setTimeout(() => {
    if (!sh.classList.contains('open')) { sh.hidden = true; sc.hidden = true; }
  }, 320);
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
                             ['#i-search-m', 'search'], ['#i-close', 'close'],
                             ['#i-sheet-close', 'close']]) {
    const el = $(sel);
    if (el) el.innerHTML = icon(name, 20);
  }

  // ⚠️ THE PREVIEW BAR rides on shop.placeholder, the same flag that makes
  // data.pl fail, so one switch tells both the checks and whoever is reading
  // the page that this is not real yet. Without it, somebody sent the link
  // meets an invented name, invented prices and invented sizes, and a
  // checkout that cannot send an order anywhere. It goes when the flag goes,
  // and data.pl only lets the flag go once the contact details are real.
  // tools/honesty.pl fails if the sentence or its element disappears.
  const pv = $('#preview-bar');
  if (pv) {
    pv.innerHTML = shop.placeholder
      ? '<b>Preview only</b> — the name, prices, sizes and photos are placeholders, '
        + 'and nothing here can be ordered yet.'
      : '';
    pv.hidden = !shop.placeholder;
  }

  // ⚠️ Both halves come from domain.js, not from shop.shipping directly. See
  // shippingLine() for why: three screens stating one promise in three
  // hand-built sentences is three sentences that drift.
  const strip = $('#strip');
  if (strip) {
    const ret = D.returnsLine(shop);
    strip.innerHTML = esc(D.shippingLine(shop))
      + (ret ? ` &nbsp;·&nbsp; ${esc(ret)}` : '');
  }
}
