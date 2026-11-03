// ============================================================================
// DEVI Collections — entry point.
//
// The ONLY module that knows every screen exists. Each page module registers
// itself into the router at import time, which is why importing them is all
// that happens here — and why ui.js and router.js must never import back.
// ============================================================================

import * as store from './store.js';
import * as router from './router.js';
import { $, $$, drawChrome, refreshCounts, openDrawer, closeDrawer, toast } from './ui.js';
import { initSidebar } from './sidebar.js';
import { logo, seal } from './brand.js';
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
import './pages/admin.js';
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
  await refreshCounts();

  // One subscription each, at boot, never torn down. A screen must not own
  // the header's counts — it would resubscribe on every visit.
  store.live.subscribe('cart', refreshCounts);
  store.live.subscribe('wishlist', refreshCounts);
  store.live.subscribe('quota', () =>
    toast('This browser is out of storage space. Some changes were not saved.'));

  wireChrome();
  await router.start();
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
  document.addEventListener('devi:route', (e) => {
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

    const add = e.target.closest('[data-add]');
    if (add) {
      e.preventDefault();
      const p = await store.catalog.byId(add.dataset.add);
      if (!p) return;
      // A card has no variant picker, so the first of each axis is implied.
      // The detail page is where a real choice is made.
      const variant = {};
      if (p.variants && p.variants.colour && p.variants.colour.length) {
        variant.colour = p.variants.colour[0].id;
      }
      if (p.variants && p.variants.size && p.variants.size.length) {
        variant.size = p.variants.size[0].id;
      }
      await store.cart.add(p.id, 1, variant);
      toast(`${p.name} added to your bag`);
      return;
    }
  });
}

// The lotus seal as the favicon, inlined.
//
// ⚠️ A data: URI SVG is a separate document and cannot read the page's own CSS
// custom properties, so the colour has to be a literal. Rather than typing one
// here -- which would be a second source of truth for the brand gold -- it is
// READ OUT of the computed style, so tokens.css stays the only place it is
// defined.
function favicon() {
  const gold = getComputedStyle(document.documentElement)
    .getPropertyValue('--gold').trim() || 'currentColor';
  const svg = seal(32).replace('class="seal"', 'style="color:' + gold + '"');
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  document.head.appendChild(link);
}

favicon();
boot();
