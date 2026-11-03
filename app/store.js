// ============================================================================
// DEVI Collections — the store facade.
//
// Nine lines of re-export, and that is the entire point. Changing ONE import
// here swaps every screen in the app from localStorage to a real server, with
// no other file touched -- the same seam kirana keeps and railsathi has
// already walked through.
//
// It works because both backends obey the four rules documented at the top of
// backend-local.js: every method async, returns deep-cloned, ids minted by the
// backend, and live.subscribe returns an unsubscribe.
//
// ⚠️ backend-supabase.js is DELIBERATELY NOT WRITTEN. Several hundred lines of
// untested code against a schema that does not exist is speculation, not
// preparation.
// ============================================================================

import * as backend from './backend-local.js';
// import * as backend from './backend-supabase.js';   // <-- the swap

export const {
  ready, catalog, cart, wishlist, orders, profile, ui, live, clearEverything,
} = backend;
