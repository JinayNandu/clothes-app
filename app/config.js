// ============================================================================
// Vastra Apparel — CDN pins. TECHNICAL PLUMBING ONLY.
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
//   cdn.jsdelivr.net            @supabase/supabase-js 2.118.0 (+esm), 2026-11-04
// ============================================================================

export const CDN = {
  // Loaded on demand for the UPI QR, never in the document head.
  qrcode: 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  // Loaded only when a gateway key is actually configured.
  razorpay: 'https://checkout.razorpay.com/v1/checkout.js',
  // Loaded only when SUPABASE below names a project. The same exact version
  // kirana runs, so it is one that has been followed end to end.
  supabase: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm',
};

// ---------------------------------------------------------------------------
// THE DATABASE -- this shop's own Supabase project. See db/SETUP.md.
//
// BOTH EMPTY means one-browser mode: everything in this browser, which keeps
// `perl tools/serve.pl 8150 app` and the single-file build working with no
// project at all. store.js switches only when BOTH are filled in.
//
// The publishable key BELONGS here. It names the project and nothing more;
// what guards the data is the rules in db/schema.sql, on the server. ⚠️ NEVER
// the secret key (sb_secret_... or a legacy service_role key): it ignores every
// rule. tools/db.pl fails on anything here that is not a publishable key.
// ---------------------------------------------------------------------------
export const SUPABASE = {
  url: 'https://tquymsewhzfawjkyysax.supabase.co',
  key: 'sb_publishable_KrRjRgDAdgtBbzEKcuAGdw_Saeci61h',
};

// ---------------------------------------------------------------------------
// SIGNING IN -- an email and a six-digit code (step 7). See db/SETUP.md, 7.
//
// ON since 7 November 2026, once the project had a sender of its own (Brevo)
// and both templates carried {{ .Token }} -- SETUP step 7.
//
// ⚠️ TURN IT OFF if the project ever stops sending codes: a lapsed sender, a
// template put back to the default link, SMTP switched off. Out of the box
// Supabase mails a LINK, and only a handful an hour, so on, the box would
// promise a code that never comes. Off, nothing anywhere offers to sign in --
// store.js leaves `account` null, as in one-browser mode -- and every order
// still goes through as a guest, exactly as before step 7.
// ---------------------------------------------------------------------------
export const SIGN_IN = true;

// How many digits the code has. ⚠️ MUST MATCH THE PROJECT: Authentication ->
// Sign In / Providers -> Email -> Email OTP Length. Supabase ships 6 and allows
// up to 10; set to 8 against a page expecting 6, the box sends the first six
// digits and every code the customer types is "wrong" (Milan's config.js).
export const OTP_LEN = 6;

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
