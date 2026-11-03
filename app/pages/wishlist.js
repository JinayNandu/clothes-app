// ============================================================================
// Wishlist. Ids only, resolved against the catalogue at render — the same
// reason a cart line stores no price.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { h1, emptyState } from '../ui.js';
import { productGrid } from '../components.js';
import { seal } from '../brand.js';

router.registerScreen('wishlist', async (host) => {
  await paint(host);
  router.onLeave(store.live.subscribe('wishlist', () => paint(host)));
});

async function paint(host) {
  const [list, shop, ids] = await Promise.all([
    store.wishlist.products(), store.catalog.shop(), store.wishlist.ids(),
  ]);

  if (!list.length) {
    host.innerHTML = h1('Your wishlist', 'Saved')
      + emptyState(seal(64), 'No pieces saved yet.',
        'Tap the heart on anything you would like to keep in mind. It stays in this browser.',
        'Browse new arrivals', '#/new');
    return;
  }

  host.innerHTML = h1('Your wishlist', 'Saved',
      `${list.length} ${list.length === 1 ? 'piece' : 'pieces'} saved in this browser.`)
    + productGrid(list, shop, ids);
}
