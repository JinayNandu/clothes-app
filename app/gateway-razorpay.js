// ============================================================================
// DEVI Collections — the Razorpay seam.
//
// THIS FILE SHIPS KNOWING ONLY HOW TO REFUSE, and that is deliberate. It is
// the same stance kirana takes with backend-supabase.js: several hundred lines
// of untested integration against credentials that do not exist is
// speculation, not preparation.
//
// ---------------------------------------------------------------------------
// ⚠️ THE THING EVERYONE GETS WRONG
//
// Razorpay Checkout's success handler returns `razorpay_payment_id` IN THE
// BROWSER. It is client-side and trivially forgeable — anyone can call the
// handler by hand from the console. Verifying it requires an HMAC-SHA256 over
// `order_id|payment_id` using the KEY SECRET, which cannot exist in a static
// page without handing it to every visitor.
//
// So a gateway response here is RECORDED AND NOT TRUSTED:
// orders.recordGatewayClaim() writes { paymentId, verified: false } and never
// touches `paid`. tools/honesty.pl fails on any code path that tries.
//
// ---------------------------------------------------------------------------
// TO MAKE THIS REAL, four things, in this order:
//
// 1. Stand up a server exposing three endpoints:
//
//      POST /orders   Creates a Razorpay Order. ⚠️ The amount MUST be computed
//                     from the SERVER's copy of the catalogue, never taken
//                     from the request body — an amount the customer can edit
//                     means anyone pays ₹1 for a ₹5,000 basket.
//      POST /verify   HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET),
//                     compared in constant time against razorpay_signature.
//      POST /webhook  `payment.captured`, signature-checked. THIS is the only
//                     payment confirmation that can be trusted, because it
//                     comes from Razorpay to you and never passes through a
//                     browser.
//
// 2. app/data/shop.json → gateway.keyId = "rzp_test_…" then "rzp_live_…",
//    gateway.serverBase = that server's base URL, gateway.live = true.
//    tools/data.pl FAILS on live:true with an empty serverBase, so it is not
//    possible to flip one boolean and have the site start claiming more than
//    it can prove.
//
// 3. Implement openCheckout() below against those endpoints.
//
// 4. app/store.js → swap the import to a real backend. Orders have to live
//    where the merchant can see them; an order in a customer's localStorage
//    has not reached anybody.
//
// Plus, outside the code: Razorpay business KYC, a settlement account, and the
// webhook URL and secret registered in their dashboard.
// ============================================================================

import { CDN, loadScript } from './config.js';
import { gatewayState } from './domain.js';

export const isConfigured = (gw) => gatewayState(gw).on;

/**
 * Opens Razorpay Checkout.
 *
 * Returns { paymentId, at } on a reported success — "reported" being the
 * operative word, see the header. Throws otherwise.
 */
export async function openCheckout(order, gw, profile) {
  const state = gatewayState(gw);
  if (!state.on) throw new Error('GATEWAY_NOT_CONFIGURED');
  if (!gw.serverBase) throw new Error('GATEWAY_HAS_NO_SERVER');

  // ⚠️ onerror, not a bare await. Zscaler and corporate proxies block CDNs,
  // and a blocked script with no error branch leaves a spinner turning for
  // ever — the single most expensive failure to diagnose from a screenshot.
  try {
    await loadScript(CDN.razorpay);
  } catch {
    throw new Error('GATEWAY_SCRIPT_BLOCKED');
  }

  // Everything below this line is the part that needs the server from step 1.
  // It is left unwritten on purpose rather than mocked, because a mock here
  // would be indistinguishable from a working integration right up until the
  // first real customer.
  throw new Error('GATEWAY_NOT_IMPLEMENTED');
}
