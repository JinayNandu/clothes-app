// ============================================================================
// Vastra Apparel — entry point.
//
// The ONLY module that knows every screen exists. Each page module registers
// itself into the router at import time, which is why importing them is all
// that happens here — and why ui.js and router.js must never import back.
// ============================================================================

import * as store from './store.js';
import * as router from './router.js';
import { $, $$, drawChrome, refreshCounts, openDrawer, closeDrawer, toast, favicon,
         flyToBag, openSheet } from './ui.js';
import { setBag, paintCtas, sizePanel, setCardColour, sizeChart, chartFor,
         setRatings, paintRatings } from './components.js';
import { initSidebar } from './sidebar.js';
import { askToBeTold } from './notify.js';
import { logo } from './brand.js';
import { esc } from "./ui.js";
import * as D from "./domain.js";

// Each of these calls registerScreen() at module scope.
import './pages/home.js';
import './pages/listing.js';
import './pages/product.js';
import './pages/cart.js';
import './pages/checkout.js';
import './pages/confirm.js';
import './pages/wishlist.js';
import './pages/account.js';
import './pages/info.js';
// ⚠️ NO STORE MODULE, EVER. The store is its own page, owner.html, with its
// own entry, owner.js, and its own link. Importing pages/admin.js here would
// put the store inside every customer's download; routes.pl fails if it is.
import './pages/notfound.js';

async function boot() {
  try {
    await store.ready();
  } catch (e) {
    // ⚠️ A failed fetch here is the whole app. Say so, rather than leaving an
    // empty page that looks like a design choice.
    document.getElementById('main').innerHTML =
      `<div class="notice notice-bad" style="margin:var(--s6) 0">
        <div><b>The catalogue did not load.</b><br>
        ${esc(String(e.message || e))}<br><br>
        This page needs an http:// origin — ES modules and fetch both refuse to
        run from a file:// path. Start the local server with
        <code>perl tools/serve.pl 8130 app</code> and open
        <code>http://127.0.0.1:8130</code>.</div></div>`;
    return;
  }

  const shop = await store.catalog.shop();
  drawChrome(shop);
  document.getElementById('ftr-logo').innerHTML = logo('sm');
  document.getElementById('drawer-logo').innerHTML = logo('sm');

  const c = shop.contact;
  document.getElementById('ftr-legal').textContent =
    `© ${D.istDate().slice(0, 4)} ${shop.brand.name}. ${shop.brand.tagline}`;
  document.getElementById('ftr-contact').textContent =
    [c.phone, c.email].filter(Boolean).join(' · ') || 'Contact details coming soon';

  await initSidebar();
  await syncBag();

  // One subscription each, at boot, never torn down. A screen must not own
  // the header's counts — it would resubscribe on every visit.
  store.live.subscribe('cart', syncBag);
  store.live.subscribe('wishlist', refreshCounts);
  store.live.subscribe('quota', () =>
    toast('This browser is out of storage space. Some changes were not saved.'));

  wireChrome();

  // Every product's average rating, for the cards (8 November 2026). Asked
  // once, never awaited: the shop draws first and the stars arrive after.
  // Without a database, or before schema.sql has reviews, nothing shows.
  if (store.reviews) {
    const loadRatings = () => store.reviews.summary()
      .then((m) => { setRatings(m); paintRatings(); })
      .catch(() => { /* no reviews to show -- the cards simply carry none */ });
    loadRatings();
    store.live.subscribe('reviews', loadRatings);
  }

  await router.start();
}

/** The bag, read once per change. Every card's − n + (components.js) and the
 *  header's count (ui.js) follow it; the cards first, because the finger is
 *  on one of them, and the header may be holding its number for a flight. */
async function syncBag() {
  setBag(await store.cart.lines());
  paintCtas();
  await refreshCounts();
}

function wireChrome() {
  $('#burger').addEventListener('click', () => {
    openDrawer();
    $('#burger').setAttribute('aria-expanded', 'true');
  });
  const shut = () => {
    closeDrawer();
    $('#burger').setAttribute('aria-expanded', 'false');
  };
  $('#drawer-close').addEventListener('click', shut);
  $('#scrim').addEventListener('click', shut);
  $('#scrim').hidden = false;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#drawer').classList.contains('open')) shut();
    // A card's size panel -- unless the size guide is open over it, in which
    // case this Escape is the guide's (ui.js) and the panel waits behind it.
    // The class, not [hidden]: a closed sheet stays unhidden for 320ms while
    // it slides away, and an Escape in that time is the panel's.
    if (e.key === 'Escape' && sizesOpen && !$('#sheet').classList.contains('open')) closeSizes(true);
  });

  // A link inside the drawer must close it, or the next screen renders behind
  // a scrim nobody can see past.
  $('#drawer').addEventListener('click', (e) => {
    if (e.target.closest('a')) shut();
  });

  // Search, both copies.
  for (const id of ['#search-form', '#search-form-m']) {
    const f = $(id);
    if (!f) continue;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = f.querySelector('input').value.trim();
      if (!q) return;
      router.go('/search', { q });
      shut();
      $('#search-row').classList.remove('open');
    });
  }

  const st = $('#search-toggle');
  st.addEventListener('click', () => {
    const row = $('#search-row');
    const open = row.classList.toggle('open');
    st.setAttribute('aria-expanded', String(open));
    if (open) row.querySelector('input').focus();
  });

  // Nav highlighting, driven by the route rather than by click.
  document.addEventListener('vastra:route', (e) => {
    const p = e.detail.path;
    for (const a of $$('[data-nav]')) {
      const t = a.dataset.nav;
      const on = t === '/' ? p === '/' : p.startsWith(t);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  });

  // ---------------------------------------------------------------------
  // DELEGATED ACTIONS. One listener for the whole document, so a screen that
  // re-renders its own markup never has to re-wire its buttons.
  // ---------------------------------------------------------------------
  document.addEventListener('click', async (e) => {
    // A tap anywhere else closes an open size panel. Not the Add to bag that
    // opened it, which closes it itself, and not the size guide sheet that
    // the panel opened, which sits over everything.
    if (sizesOpen && !e.target.closest('[data-sizes-panel], [data-add], #sheet, #sheet-scrim')) {
      closeSizes(false);
    }

    const wish = e.target.closest('[data-wish]');
    if (wish) {
      e.preventDefault();
      const added = await store.wishlist.toggle(wish.dataset.wish);
      toast(added ? 'Saved to your wishlist' : 'Removed from your wishlist');
      await router.repaint();
      return;
    }

    // A sold-out card's Notify me (9 November 2026): asked to be told when it
    // is back -- signed in, so the email goes to an address a code proved.
    const nb = e.target.closest('[data-notify]');
    if (nb) {
      e.preventDefault();
      const p = await store.catalog.byId(nb.dataset.notify);
      if (p) askToBeTold(p, null);
      return;
    }

    // A card's Add to bag (components.js ctaInner).
    const add = e.target.closest('[data-add]');
    if (add) {
      e.preventDefault();
      const p = await store.catalog.byId(add.dataset.add);
      if (!p) return;
      const card = add.closest('.card');
      const box = add.closest('[data-cta]');
      const sizes = (p.variants && p.variants.size) || [];
      // ⚠️ Never a size nobody chose: with more than one, ask.
      if (sizes.length > 1) {
        if (sizesOpen && sizesOpen.add === add) closeSizes(true);
        else openSizes(card, add, p, await store.catalog.shop());
        return;
      }
      closeSizes(false);   // another card's panel, if one is open
      const only = { colour: box.dataset.colour, size: sizes.length ? sizes[0].id : '' };
      if (!D.skuStock(p, only)) { toast('Sold out in this colour'); return; }
      await addOne(card, p, only);
      return;
    }

    // A size tapped in the panel: that size, in the colour the card shows.
    const pick = e.target.closest('[data-pick]');
    if (pick && sizesOpen) {
      e.preventDefault();
      const { p, panel } = sizesOpen;
      const card = panel.closest('.card');
      const fromKeys = panel.contains(document.activeElement);
      closeSizes(false);
      await addOne(card, p, { colour: card.querySelector('[data-cta]').dataset.colour,
                              size: pick.dataset.pick });
      // Keyboard users land on the new bar's +, not on the body.
      const more = card.querySelector('[data-more]');
      if (fromKeys && more) more.focus({ preventScroll: true });
      return;
    }

    if (e.target.closest('[data-sizes-close]')) {
      closeSizes(true);
      return;
    }

    if (e.target.closest('[data-sizes-guide]') && sizesOpen) {
      const { p } = sizesOpen;
      const shop = await store.catalog.shop();
      const chart = chartFor(p, shop);
      openSheet(`Size chart — ${(chart && chart.label) || p.name}`, sizeChart(p, shop, null));
      return;
    }

    // The + and − of a card's bar. Both read the bag itself, not the number
    // on the card, which a second tab or a second quick tap may have moved.
    const more = e.target.closest('[data-more]');
    const less = e.target.closest('[data-less]');
    if (more || less) {
      e.preventDefault();
      const key = (more || less).closest('[data-line]').dataset.line;
      const line = (await store.cart.lines()).find((l) => D.lineKey(l) === key);
      if (!line) return;
      if (more) {
        const p = await store.catalog.byId(line.pid);
        // No more than there is of that colour in that size.
        if (p && line.qty < D.lineMax(p, line.variant)) await addOne(more.closest('.card'), p, line.variant);
      } else {
        await store.cart.setQty(key, line.qty - 1);
        if (line.qty === 1) toast('Removed from your bag');
      }
      return;
    }

    // A colour dot on a card (components.js setCardColour).
    const sw = e.target.closest('.card [data-sw]');
    if (sw) {
      e.preventDefault();
      const card = sw.closest('.card');
      const p = await store.catalog.byId(card.dataset.pid);
      if (p) setCardColour(card, p, sw.dataset.sw);
    }
  });
}

// ---------------------------------------------------------------------------
// THE CARD'S SIZE PANEL -- one open at a time, anywhere on the page. It
// closes on a size, on ×, on Escape, on a tap elsewhere and on Add to bag
// again; a screen that redraws simply takes it with the card.
// ---------------------------------------------------------------------------
let sizesOpen = null;      // { panel, add, p }

function openSizes(card, add, p, shop) {
  closeSizes(false);
  const box = card.querySelector('[data-cta]');
  card.insertAdjacentHTML('beforeend', sizePanel(p, shop, (box && box.dataset.colour) || ''));
  const panel = card.lastElementChild;
  sizesOpen = { panel, add, p };
  add.setAttribute('aria-expanded', 'true');
  const first = panel.querySelector('[data-pick]:not(:disabled)');
  if (first) first.focus({ preventScroll: true });
}

function closeSizes(refocus) {
  if (!sizesOpen) return;
  const { panel, add } = sizesOpen;
  sizesOpen = null;
  panel.remove();
  if (!add.isConnected) return;
  add.setAttribute('aria-expanded', 'false');
  if (refocus) add.focus({ preventScroll: true });
}

/** One more of a line, from a card: the flight, the add, and a message that
 *  names what went in -- the colour and the size, in words. */
async function addOne(card, p, variant) {
  const v = {};
  if (variant.colour) v.colour = variant.colour;
  if (variant.size) v.size = variant.size;
  // ⚠️ The flight BEFORE the add: it tells the header to hold the count
  // until the picture lands, and the add is what changes the count.
  flyToBag(card && card.querySelector('.card-art'));
  await store.cart.add(p.id, 1, v);
  const label = D.variantLabel(p, v);
  toast(`${p.name}${label ? ' · ' + label : ''} added to your bag`);
}

favicon();
boot();
