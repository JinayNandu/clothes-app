// ============================================================================
// "Notify me when it's back" (9 November 2026, the owner: "the user then has
// the option to express interest for the product and if that product is
// active again ... the other user gets a notification"). Offered wherever
// something cannot be bought: a product disabled or out of stock -- on its
// card and its page -- and one colour in one size that has run out, on the
// page. The database emails the customer once it can be bought (db/schema.sql
// register_interest, wake_interest, send_notices), then forgets the request.
//
// ⚠️ SIGNED IN, ALWAYS. The email goes to the account's own address, proved
// by a code, so nobody can make the shop email a stranger. Not signed in,
// the sign-in box opens in the sheet -- never a screen of its own -- and the
// request goes through the moment it is done.
// ============================================================================

import * as store from './store.js';
import { $, esc, toast, openSheet, closeSheet } from './ui.js';
import { signInBox, wireSignIn } from './signin.js';
import * as D from './domain.js';

/** The colour and size a stock key names, as a selection. */
export function selOf(p, sku) {
  if (!sku) return {};
  const cols = (p.variants && p.variants.colour) || [];
  const sizes = (p.variants && p.variants.size) || [];
  const [a, b] = String(sku).split('/');
  if (cols.length && sizes.length) return { colour: a, size: b };
  return cols.length ? { colour: a } : { size: a };
}

/** "Utility Shirt", or "Utility Shirt in Navy · M". */
export function waitLabel(p, sku) {
  const v = D.variantLabel(p, selOf(p, sku));
  return sku && v ? `${p.name} in ${v}` : p.name;
}

// What this customer is waiting for, read once and again after a change.
let mine = null;
export function waitingFor() {
  if (!store.interest) return Promise.resolve([]);
  if (!mine) mine = store.interest.mine().catch(() => []);
  return mine;
}
export const forget = () => { mine = null; };

export async function isWaiting(p, sku) {
  return (await waitingFor()).some((w) => w.pid === p.id && (w.sku || null) === (sku || null));
}

/** Ask to be told. `sku` is one colour in one size, or null for any. */
export async function askToBeTold(p, sku = null) {
  if (!store.interest) {
    toast('Ask us on WhatsApp or by phone, and we will tell you when it is back.');
    return;
  }
  const what = waitLabel(p, sku);
  let who = null;
  try { who = await store.account.whoami(); } catch (e) { who = null; }
  if (who && !who.guest && who.email) {
    await register(p, sku, what);
    return;
  }
  openSheet('Tell me when it is back', signInBox(`Sign in with your email, and we email you
    the moment <b>${esc(what)}</b> can be ordered again. There is no password: we send
    you a code.`));
  wireSignIn($('#sheet-body'), async () => {
    closeSheet();
    await register(p, sku, what);
  });
}

async function register(p, sku, what) {
  try {
    const email = await store.interest.add(p.id, sku);
    forget();
    toast(`We will email ${email} when ${what} is back.`);
  } catch (e) {
    const m = String((e && e.message) || e);
    toast(/SIGN_IN_FIRST|ACCOUNT_GONE/.test(m) ? 'Please sign in again, then ask once more.'
      : /TOO_MANY/.test(m) ? 'That is a lot of requests in an hour. Please try again later.'
        : /GONE_FROM_CATALOGUE/.test(m) ? 'This style is no longer in the shop.'
          : /PGRST202|Could not find the function/.test(m) ? 'This is not switched on yet. Please ask us on WhatsApp or by phone.'
            : /fetch|network|Load failed/i.test(m) ? 'We could not reach the shop just now. Please try again.'
              : `That did not go through: ${m}`);
  }
}

/** "Don't tell me after all." */
export async function stopWaiting(p, sku = null) {
  if (!store.interest) return;
  try {
    await store.interest.drop(p.id, sku);
    forget();
    toast('We will not email you about it.');
  } catch (e) {
    toast('That did not go through. Please try again.');
  }
}
