// ============================================================================
// Vastra Apparel — the store facade.
//
// The screens import THIS and never a backend. app/config.js either names a
// Supabase project or it does not, and this file picks accordingly: with no
// project, everything lives in this browser; with one, an order placed on a
// customer's phone is on the store's board wherever the store is opened.
//
// Both backends obey the four rules at the top of backend-local.js: every
// method async, returns deep-cloned, ids minted by the backend, and
// live.subscribe returns an unsubscribe.
//
// ⚠️ LIVE BINDINGS, NOT A TOP-LEVEL AWAIT. These start as the local backend
// and ready() re-points the ones the server owns, before any screen runs.
// `import * as store` reads them at the moment of the call, so every page gets
// whichever backend is live. A top-level `await import()` would do the same in
// one line -- and the single-file build cannot bundle one.
// ============================================================================

import * as local from './backend-local.js';
import { SUPABASE, SIGN_IN } from './config.js';

/** True when this page has a database behind it: a project named in config.js
 *  AND an http(s) page. The single-file build opens from file://, where there
 *  is no network to assume, so it stays in one-browser mode whatever the
 *  config says. The screens use this to tell the truth about where an order
 *  goes -- "it is with us" means something else when the only copy is here. */
export const shared = () => !!(SUPABASE.url && SUPABASE.key)
  && /^https?:$/.test(location.protocol);

export let catalog = local.catalog;
export let cart = local.cart;
export let wishlist = local.wishlist;
export let profile = local.profile;
export let ui = local.ui;
export let orders = local.orders;
export let live = local.live;
export let clearEverything = local.clearEverything;
/** The store page's door: null in one-browser mode, where there is no server
 *  to check a code and so no code. */
export let staff = null;
/** A customer's sign-in (an email and a code) and their address book. Null in
 *  one-browser mode, and while config.js SIGN_IN is off: a page that finds
 *  `account` null offers no sign-in anywhere. */
export let account = null;
export let addresses = null;
/** Ratings and reviews (8 November 2026). Null in one-browser mode: with no
 *  server, a review would reach nobody, so nothing asks for one. */
export let reviews = null;
/** The store's catalogue: every product, and the calls that add one and
 *  change its price, stock and photographs (8 November 2026). On the
 *  database with one; in one browser, the overlay of backend-local.js. */
export let catalogAdmin = local.catalogAdmin;
/** "Tell me when it's back" (9 November 2026): signed-in customers only,
 *  so null in one-browser mode and while SIGN_IN is off. */
export let interest = null;

let server = null;

/**
 * ⚠️ THE CATALOGUE IS ASKED FOR BESIDE THE SHOP'S OWN FILES, not after them
 * (8 November 2026): one plain request with the publishable key, no session,
 * no supabase-js download, so browsing costs no more time than it did. If
 * the database cannot be reached -- or db/SETUP.md step 11 has not been run
 * -- the shop shows app/data/catalog.json, and an order is still checked
 * against the database's prices when it is placed.
 */
export async function ready() {
  const files = local.ready();
  if (!shared()) { await files; return; }
  server = await import('./backend-supabase.js');
  ({ orders, live, clearEverything, staff, reviews, catalogAdmin } = server);
  if (SIGN_IN) ({ account, addresses, interest } = server);
  const [, list] = await Promise.all([files, server.loadCatalogue().catch((e) => {
    console.warn('[vastra] the catalogue is not in the database; showing the file', e);
    return null;
  })]);
  if (list) local.useCatalogue(list);
}

/** Read the catalogue from the database again -- after an order is refused
 *  because a price or the stock moved since this page loaded. */
export async function refreshCatalogue() {
  if (!server) return false;
  try { local.useCatalogue(await server.loadCatalogue()); return true; } catch (e) { return false; }
}

/** A session, made if there is none: the store page needs one before it can
 *  claim the code. The shop does not call this -- browsing never touches the
 *  server, and place() makes a session at the moment one is needed. */
export async function begin() { return server ? server.begin() : null; }
