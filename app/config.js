// ============================================================================
// DEVI Collections — CDN pins. TECHNICAL PLUMBING ONLY.
//
// ⚠️ NOTHING THE BUSINESS OWNS GOES IN THIS FILE. Prices, the phone number,
// shipping rules, coupon codes and the UPI id all live in data/shop.json, so
// that changing them needs no knowledge of JavaScript and so the Perl checks
// read the same numbers the app does.
//
// Reachability through the corporate proxy was TESTED, not assumed -- a
// blocked CDN fails silently and looks exactly like the app being broken.
// Verified 2026-11-01, all returned 200:
//   fonts.googleapis.com        Cormorant Garamond + Manrope
//   cdnjs.cloudflare.com        qrcodejs 1.0.0
//   checkout.razorpay.com       v1/checkout.js
// ============================================================================

export const CDN = {
  // Loaded on demand for the UPI QR, never in the document head.
  qrcode: 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  // Loaded only when a gateway key is actually configured.
  razorpay: 'https://checkout.razorpay.com/v1/checkout.js',
};

/**
 * Inject a script once, and FAIL LOUDLY if it does not arrive.
 * ⚠️ The onerror branch is the whole reason this helper exists. Without it a
 * blocked CDN leaves a spinner turning for ever, which is the single most
 * expensive failure mode to diagnose from a screenshot.
 */
const loaded = new Map();
export function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error('BLOCKED: ' + src));
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}
