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

export function flyToBag(from, qty = 1, near = null) {
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
  const hdrBottom = hdr ? hdr.getBoundingClientRect().bottom : 0;
  let left = r.left;
  let width = r.width;
  let top = Math.max(r.top, hdrBottom);
  let h = Math.min(r.bottom, innerHeight) - top;
  // The copy: the whole picture, offset so the visible part sits exactly
  // where it was.
  let copyCss = `top:${r.top - top}px;width:${r.width}px;height:${r.height}px`;
  if (h < 40 || r.width < 40) {
    // ⚠️ THE PICTURE IS OFF SCREEN. On a phone the product page's Add to bag
    // sits well below its photo, and the flight used to be skipped there
    // without a word -- the owner, 8 November 2026: no animation on the
    // product page. So a small copy of the photo lifts off from the button
    // that was pressed (`near`), and flies from where the finger is.
    const n = near && near.getBoundingClientRect();
    if (!n || !n.width || n.bottom < hdrBottom || n.top > innerHeight) return;
    width = 64;
    h = 80;                                   // the photographs' 4:5
    left = n.left + n.width / 2 - width / 2;
    top = Math.max(hdrBottom, n.top + n.height / 2 - h / 2);
    copyCss = `top:0;width:${width}px;height:${h}px;object-fit:cover`;
  }

  const ghost = document.createElement('div');
  ghost.className = 'fly';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${h}px`;
  ghost.innerHTML = '<div class="fly-y"><div class="fly-pic"></div></div>';
  const copy = pic.cloneNode(true);
  copy.removeAttribute('loading');
  copy.style.cssText = copyCss;
  const box = ghost.querySelector('.fly-pic');
  box.appendChild(copy);
  document.body.appendChild(ghost);

  const dx = to.left + to.width / 2 - (left + width / 2);
  const dy = to.top + to.height / 2 - (top + h / 2);
  const big = Math.max(width, h);
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
// ASK FIRST — a pop-up that asks before a step is taken (8 November 2026, on
// the owner's word: "dont ask me to press the button again -- only show a pop
// up to confirm"). It replaced every second tap on the store's board.
//
// ⚠️ NOT window.confirm(). The artifact and single-file viewers answer it "no"
// at once without showing anything, so every step would silently fail there.
// This is the page's own element, made on first use, so the shop and the
// store page share it without either carrying it in its markup.
//
// Resolves to null when the person backs out -- Not now, the scrim, Escape --
// and otherwise to an object of every named input inside it (the courier and
// the tracking number, for a step through Shipped). Same discipline as the
// sheet: what is behind it goes inert, the body stops scrolling, focus comes
// back where it was, and no requestAnimationFrame (see openSheet).
// ---------------------------------------------------------------------------
let askEl = null;
let askDone = null;

export function askFirst({ title, body = '', more = '', yes = 'Yes', no = 'Not now',
                           danger = false } = {}) {
  if (askDone) askDone(null);          // one at a time: a new ask answers the old one "no"
  if (!askEl) {
    askEl = document.createElement('div');
    askEl.className = 'ask-wrap';
    askEl.hidden = true;
    askEl.innerHTML = `<div class="ask-scrim" data-ask-no></div>
      <div class="ask" role="alertdialog" aria-modal="true"
           aria-labelledby="ask-title" aria-describedby="ask-body">
        <h2 class="ask-title" id="ask-title"></h2>
        <div class="ask-body" id="ask-body"></div>
        <div class="ask-more"></div>
        <div class="ask-acts">
          <button type="button" class="btn btn-secondary" data-ask-no></button>
          <button type="button" class="btn btn-primary" data-ask-yes></button>
        </div>
      </div>`;
    document.body.appendChild(askEl);
    askEl.addEventListener('click', (e) => {
      if (!askDone) return;
      if (e.target.closest('[data-ask-yes]')) askDone(askRead());
      else if (e.target.closest('[data-ask-no]')) askDone(null);
    });
    askEl.addEventListener('keydown', (e) => {
      // Enter in a field below the question means yes, as in any form.
      if (e.key === 'Enter' && e.target.matches('.ask-more input') && askDone) {
        e.preventDefault();
        askDone(askRead());
      }
    });
    // Capture, and stopped there: the sheet and the size panel listen for
    // Escape on the document too, and must not close under the pop-up.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && askDone) { e.stopPropagation(); askDone(null); }
    }, true);
  }

  const box = askEl.querySelector('.ask');
  box.classList.toggle('is-danger', !!danger);
  askEl.querySelector('.ask-title').textContent = title || '';
  askEl.querySelector('.ask-body').innerHTML = body;
  askEl.querySelector('.ask-more').innerHTML = more;
  const yesBtn = askEl.querySelector('[data-ask-yes]');
  const noBtn = askEl.querySelector('.ask-acts [data-ask-no]');
  yesBtn.textContent = yes;
  yesBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  noBtn.textContent = no;

  const back = document.activeElement;
  const shell = $('#shell'), head = $('#site-header');
  const wasInert = [shell && shell.inert, head && head.inert];
  const wasOverflow = document.body.style.overflow;
  askEl.hidden = false;
  void askEl.offsetHeight;             // flush the closed state, so it animates
  askEl.classList.add('open');
  if (shell) shell.inert = true;
  if (head) head.inert = true;
  document.body.style.overflow = 'hidden';
  const firstField = askEl.querySelector('.ask-more input');
  // A step that cannot be undone starts on "Not now"; any other on the field
  // to fill in, or on yes.
  (danger ? noBtn : firstField || yesBtn).focus();

  return new Promise((resolve) => {
    askDone = (answer) => {
      askDone = null;
      askEl.classList.remove('open');
      if (shell) shell.inert = !!wasInert[0];
      if (head) head.inert = !!wasInert[1];
      document.body.style.overflow = wasOverflow;
      if (back && back.isConnected && back.focus) back.focus();
      setTimeout(() => { if (!askEl.classList.contains('open')) askEl.hidden = true; }, 200);
      resolve(answer);
    };
  });
}

function askRead() {
  const got = {};
  for (const el of askEl.querySelectorAll('.ask-more [name]')) got[el.name] = el.value.trim();
  return got;
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
                             ['#i-user', 'user'],
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
