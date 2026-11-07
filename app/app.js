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
         flyToBag } from './ui.js';
import { setBag, paintCtas } from './components.js';
import { initSidebar } from './sidebar.js';
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
    const wish = e.target.closest('[data-wish]');
    if (wish) {
      e.preventDefault();
      const added = await store.wishlist.toggle(wish.dataset.wish);
      toast(added ? 'Saved to your wishlist' : 'Removed from your wishlist');
      await router.repaint();
      return;
    }

    // A card's Add to bag, and the + of its − n + (components.js).
    const add = e.target.closest('[data-add]');
    if (add) {
      e.preventDefault();
      const p = await store.catalog.byId(add.dataset.add);
      if (!p) return;
      // A card has no variant picker, so the first of each axis is implied.
      // The detail page is where a real choice is made.
      const variant = D.defaultVariant(p);
      // ⚠️ The flight BEFORE the add: it tells the header to hold the count
      // until the picture lands, and the add is what changes the count.
      const card = add.closest('.card');
      flyToBag(card && card.querySelector('.card-art'));
      await store.cart.add(p.id, 1, variant);
      // The size goes in the message: a card adds the first size without
      // asking, and the customer should not find that out at the door.
      const label = D.variantLabel(p, variant);
      toast(`${p.name}${label ? ' · ' + label : ''} added to your bag`);
      return;
    }

    // The − of a card's − n +. At one it takes the line off, and the card
    // goes back to Add to bag.
    const less = e.target.closest('[data-less]');
    if (less) {
      e.preventDefault();
      const key = less.closest('[data-cta]').dataset.key;
      // The bag itself, not the number on the card, which a second tab or a
      // second quick tap may already have moved.
      const line = (await store.cart.lines()).find((l) => D.lineKey(l) === key);
      if (!line) return;
      await store.cart.setQty(key, line.qty - 1);
      if (line.qty === 1) toast('Removed from your bag');
      return;
    }
  });
}

favicon();
boot();
