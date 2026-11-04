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
import { SUPABASE } from './config.js';

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

let server = null;

export async function ready() {
  await local.ready();
  if (!shared()) return;
  server = await import('./backend-supabase.js');
  ({ orders, live, clearEverything, staff } = server);
}

/** A session, made if there is none: the store page needs one before it can
 *  claim the code. The shop does not call this -- browsing never touches the
 *  server, and place() makes a session at the moment one is needed. */
export async function begin() { return server ? server.begin() : null; }
