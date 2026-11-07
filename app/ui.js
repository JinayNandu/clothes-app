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
import { logo, mark, brandBand, seal } from './brand.js';
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
//
// ⚠️ While a picture is flying to the bag (flyToBag, below) the bag's count
// is NOT painted here. The landing paints it, so the number goes up the
// moment the picture arrives and not half a second before it.
// ---------------------------------------------------------------------------
let flights = 0;

function paintBag(n) {
  for (const el of $$('[data-cart-count]')) {
    el.textContent = n;
    el.hidden = n === 0;
  }
  // Filled once something is in it (layout.css), so the bag reads as
  // "has things in it" from across the room, not only from its number.
  const bag = $('#bag');
  if (bag) bag.classList.toggle('full', n > 0);
}

export async function refreshCounts() {
  const n = await store.cart.count();
  const w = (await store.wishlist.ids()).length;
  if (!flights) paintBag(n);
  for (const el of $$('[data-wish-count]')) {
    el.textContent = w;
    el.hidden = w === 0;
  }
}

// ---------------------------------------------------------------------------
// THE FLIGHT TO THE BAG
//
// A see-through copy of the product's picture lifts off where it was tapped,
// shrinks, and arcs into the bag in the header; the bag gives a small bump
// and its count goes up as it lands -- by this flight's share only, so three
// quick taps read 1, 2, 3 and not 3, 3, 3. The last landing paints the true
// count, whatever happened in between.
//
// Three nested boxes because one box takes one easing: the outer drifts
// sideways and speeds up, the middle rises fast and settles, the inner shrinks
// and fades. Together that is an arc rather than a straight line.
//
// ⚠️ Call it BEFORE the add that it shows: `flights` is what stops
// refreshCounts painting the new number early.
// ⚠️ Web Animations, not CSS, so base.css's reduced-motion rule (animation:
// none) would NOT stop it. The media query is asked here instead, and with
// reduced motion nothing flies and the count changes at once.
// ---------------------------------------------------------------------------
const FLIGHT_MS = 720;

export function flyToBag(from, qty = 1) {
  const bag = $('#bag');
  const to = bag && bag.getBoundingClientRect();
  const pic = from && from.querySelector('img, svg');
  if (!to || !to.width || !pic || !document.body.animate
      || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Lift off from the part of the picture that is on screen: below the sticky
  // header and above the bottom edge. A card scrolled half under the header
  // must not throw its copy from somewhere nobody can see.
  const r = from.getBoundingClientRect();
  const hdr = $('#site-header');
  const top = Math.max(r.top, hdr ? hdr.getBoundingClientRect().bottom : 0);
  const h = Math.min(r.bottom, innerHeight) - top;
  if (h < 40 || r.width < 40) return;

  const ghost = document.createElement('div');
  ghost.className = 'fly';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.cssText = `left:${r.left}px;top:${top}px;width:${r.width}px;height:${h}px`;
  ghost.innerHTML = '<div class="fly-y"><div class="fly-pic"></div></div>';
  const copy = pic.cloneNode(true);
  copy.removeAttribute('loading');
  // The whole picture, offset so the visible part sits exactly where it was.
  copy.style.cssText = `top:${r.top - top}px;width:${r.width}px;height:${r.height}px`;
  const box = ghost.querySelector('.fly-pic');
  box.appendChild(copy);
  document.body.appendChild(ghost);

  const dx = to.left + to.width / 2 - (r.left + r.width / 2);
  const dy = to.top + to.height / 2 - (top + h / 2);
  const big = Math.max(r.width, h);
  const end = 26 / big;                          // about the size of the icon
  const mid = Math.max(end, Math.min(1, 150 / big));
  const opt = (easing) => ({ duration: FLIGHT_MS, easing, fill: 'forwards' });

  flights++;
  ghost.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dx}px)` }],
                opt('cubic-bezier(.4,0,.6,1)'));
  ghost.firstChild.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${dy}px)` }],
                           opt('cubic-bezier(.3,.55,.55,1)'));
  const shrink = box.animate([
    { transform: 'scale(1)', opacity: 0.9 },
    { transform: `scale(${mid})`, opacity: 0.75, offset: 0.35 },
    { transform: `scale(${end})`, opacity: 0.35 },
  ], opt('cubic-bezier(.3,0,.4,1)'));

  // Once, whichever comes first: the animation ending, or a timer in case it
  // never reports (a tab put away mid-flight). A count that waits forever
  // for a landing is worse than a flight cut short.
  let landed = false;
  const land = () => {
    if (landed) return;
    landed = true;
    ghost.remove();
    flights--;
    landBag(qty);
  };
  shrink.finished.then(land, land);
  setTimeout(land, FLIGHT_MS + 400);
}

async function landBag(qty) {
  const n = await store.cart.count();
  const el = $('[data-cart-count]');
  const shown = el && !el.hidden ? Number(el.textContent) || 0 : 0;
  paintBag(flights ? Math.min(n, shown + qty) : n);
  const bag = $('#bag');
  if (bag) {
    bag.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
                { duration: 340, easing: 'cubic-bezier(.3,1.4,.6,1)' });
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
  // checkout whose orders nobody should fulfil. ⚠️ It used to say nothing
  // could be ordered; with a database connected an order DOES reach the
  // shop, so the sentence now says what is true in both modes: an order
  // placed here is a test. It goes when the flag goes, and data.pl only lets
  // the flag go once the contact details are real.
  // tools/honesty.pl fails if the sentence or its element disappears.
  const pv = $('#preview-bar');
  if (pv) {
    pv.innerHTML = shop.placeholder
      ? '<b>Preview only</b> — the name, prices, sizes and photos are placeholders, '
        + 'and an order placed here is a test, not a purchase.'
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

// ---------------------------------------------------------------------------
// THE FAVICON — the button seal, inlined. Both pages call this.
//
// ⚠️ A data: URI SVG is a separate document and cannot read the page's own CSS
// custom properties, so the colour has to be a literal. Rather than typing one
// here -- which would be a second source of truth for the brand gold -- it is
// READ OUT of the computed style, so tokens.css stays the only place it is
// defined.
// ---------------------------------------------------------------------------
export function favicon() {
  const gold = getComputedStyle(document.documentElement)
    .getPropertyValue('--gold').trim() || 'currentColor';
  const svg = seal(32).replace('class="seal"', 'style="color:' + gold + '"');
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  document.head.appendChild(link);
}
