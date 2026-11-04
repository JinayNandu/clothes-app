// ============================================================================
// Vastra Apparel — entry point for the STORE page, owner.html.
//
// The shop's app.js has a twin here rather than a branch, because the two are
// different pages with different links: .../clothes-app/ for customers and
// .../clothes-app/store/ for whoever runs the shop. Nothing in app.js knows
// this file exists, and routes.pl fails if the shop ever imports a store
// module or links to this page.
//
// SHARED: the data layer (store.js), the router, the pure modules and the
// styles — so an order placed in the shop is the order this page lists, and
// the store looks like the same business. NOT SHARED: the route table, the
// screens, the chrome.
// ============================================================================

import * as store from './store.js';
import * as router from './router.js';
import { $, esc, emptyState, favicon } from './ui.js';
import { logo, seal } from './brand.js';
import { OWNER_ROUTES } from './domain.js';

// Registers the 'admin' screen at module scope.
import './pages/admin.js';

// The store's own not-found. The shop's points at "Shop all", which is the
// wrong way out of here.
router.registerScreen('notfound', async (host) => {
  host.innerHTML = emptyState(seal(64),
    'There is no such page in the store.',
    'The link may be mistyped. Everything the store does is in the tabs on '
    + 'the overview.',
    'Back to the overview', '#/');
});

async function boot() {
  try {
    await store.ready();
  } catch (e) {
    $('#main').innerHTML =
      `<div class="notice notice-bad" style="margin:var(--s6) 0">
        <div><b>The catalogue did not load.</b><br>
        ${esc(String(e.message || e))}</div></div>`;
    return;
  }

  const shop = await store.catalog.shop();
  $('#owner-logo').innerHTML = logo('sm');
  document.title = `Store — ${shop.brand.name}`;

  await router.start(OWNER_ROUTES);
}

favicon();
boot();
