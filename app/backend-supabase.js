// =====================================================================
//  backend-supabase.js -- the same contract as backend-local.js, over
//  this shop's own database (db/schema.sql). An order placed on a
//  customer's phone is on the store's board, wherever the board is open.
//
//  The four rules (top of backend-local.js) hold here too: every method
//  async; returns deep-cloned -- each row is translated into a fresh
//  object and nothing is cached; ids minted by the backend -- Postgres
//  mints them, and the order code with them; live.subscribe returns an
//  unsubscribe.
//
//  ---------------------------------------------------------------
//  WHAT STAYS IN THIS BROWSER: the catalogue, which is static JSON and
//  the same for everybody; the bag; the wishlist; a guest's details that
//  fill checkout in. A bag is a thing on one phone in one sitting --
//  syncing it would let a half-built bag on a laptop rewrite the one on
//  a phone. store.js takes orders, live, clearEverything and staff from
//  here, and account and addresses once config.js SIGN_IN is on.
//
//  EVERY WRITE IS A FUNCTION ON THE SERVER: place_order, advance_order,
//  set_paid, claim_staff, and for an account save_address and its two
//  siblings and the hand-over pair. No table takes a write from here
//  directly; the top of db/schema.sql says why that is the point.
//
//  SNAKE_CASE STOPS AT toApp(). A database row never reaches a screen.
// =====================================================================

import { SUPABASE, CDN } from './config.js';
import * as D from './domain.js';
import * as local from './backend-local.js';

const oops = (error) => { if (error) throw new Error(error.message || String(error)); };

// ---------------------------------------------------------------------
// The client, made once. The library is fetched on first use, so the
// shop's pages never download it until somebody places an order.
// ---------------------------------------------------------------------
let made = null;
function client() {
  if (!made) {
    made = import(CDN.supabase).then(({ createClient }) =>
      createClient(SUPABASE.url, SUPABASE.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // There is no emailed link to come back from.
          detectSessionInUrl: false,
          // ⚠️ THIS SHOP'S OWN DRAWER. All of jinaynandu.github.io is one
          // browser origin, shared with kirana and DEVI. The default key
          // names the project and would not collide, but vastra.* keeps
          // every key this shop writes under its own prefix.
          storageKey: 'vastra.auth',
        },
      }));
    // A CDN fetch that failed may be tried again on the next call.
    made.catch(() => { made = null; });
  }
  return made;
}

async function rpc(fn, args) {
  const sb = await client();
  const { data, error } = await sb.rpc(fn, args);
  oops(error);
  return data;
}

/** A customer's write: if the account behind this session no longer exists,
 *  out of it, and ACCOUNT_GONE -- never a quiet retry as a guest, because
 *  the person believes they are signed in and the order must be theirs. */
async function rpcOrGone(fn, args) {
  try {
    return await rpc(fn, args);
  } catch (e) {
    if (!refusedAsGone(e)) throw e;
    await dropSession();
    throw new Error('ACCOUNT_GONE');
  }
}

async function session() {
  const sb = await client();
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

/**
 * ⚠️ THE SESSION THIS BROWSER HOLDS, IF ITS ACCOUNT STILL EXISTS. A session
 * outlives its account in storage: delete the account on the server --
 * db/reset.sql, or a person removed in the dashboard -- and the token in
 * this browser stays signature-valid for up to an hour, the page goes on
 * saying "Signed in", and every write made with it fails on a foreign key.
 * Found 8 November 2026: the owner ran the reset, typed the store code, and
 * got "insert or update on table staff violates foreign key constraint
 * staff_user_id_fkey".
 *
 * So the server is asked, once per token, whether the account is there. A
 * definite no drops the session from this browser (and the details that
 * went with it, as signing out does), and the caller starts afresh. A
 * network failure is NOT a no: nobody is signed out over a dropped signal.
 */
let checked = { token: null, ok: false };
const accountGone = (e) => !!e && (
  ['user_not_found', 'session_not_found', 'bad_jwt'].includes(e.code)
  || /User from sub claim in JWT does not exist|Session from session_id claim in JWT does not exist/i
    .test(e.message || ''));

async function liveSession() {
  const s = await session();
  if (!s) return null;
  if (checked.token === s.access_token && checked.ok) return s;
  const sb = await client();
  const { error } = await sb.auth.getUser();
  if (error && accountGone(error)) {
    await dropSession();
    return null;
  }
  checked = { token: s.access_token, ok: true };
  return s;
}

/** Out of this browser, locally, with what was kept for the person. */
async function dropSession() {
  const sb = await client();
  checked = { token: null, ok: false };
  try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* gone either way */ }
  handover = null;
  await local.profile.clear();
  fire('session');
  fire('orders');
}

/** A write refused because the account behind this session no longer
 *  exists: every table that names a user refers to auth.users. */
const refusedAsGone = (e) => /violates foreign key constraint "\w*_user_id_fkey"/.test(
  String((e && e.message) || e));

/**
 * A session for this visitor, made silently if there is none. Anonymous:
 * nobody is asked to sign in to buy a shirt, and every order still has an
 * owner, which is what lets each read rule be one line. Signing in with an
 * email (account, below) makes this SAME user permanent, so the orders
 * placed before it stay theirs. A session whose account was deleted on the
 * server counts as none (liveSession).
 */
export async function begin() {
  const s = await liveSession();
  if (s) return s;
  const sb = await client();
  const { data, error } = await sb.auth.signInAnonymously();
  oops(error);
  // Made this moment: its account exists, with no need to ask.
  checked = { token: data.session.access_token, ok: true };
  return data.session;
}

// ---------------------------------------------------------------------
// A row, as the screens know an order. The ONLY place snake_case exists.
// ---------------------------------------------------------------------
const toApp = (r) => ({
  id: r.id,
  code: r.code,
  createdAt: r.placed_at,
  status: r.status,
  customer: {
    name: r.cust_name, mobile: r.cust_mobile, email: r.cust_email || '',
    addr: r.addr, city: r.city, state: r.state, pin: r.pin,
  },
  // Each item's own status, history and shipment since 7 November 2026.
  // `status` is undefined on a database whose schema.sql has not been re-run
  // since, and D.hasItemStatus() then keeps every per-item control away.
  lines: (r.order_lines || []).slice().sort((a, b) => a.id - b.id).map((l) => ({
    id: l.id, pid: l.pid, name: l.name, slug: l.slug, variant: l.variant || {},
    variantLabel: l.variant_label || '', qty: l.qty,
    unitPrice: l.unit_price, unitMrp: l.unit_mrp, lineTotal: l.line_total,
    status: l.status, history: l.history || [], shipment: l.shipment || null,
  })),
  itemsTotal: r.items_total, mrpTotal: r.mrp_total, saved: r.saved,
  coupon: r.coupon, discount: r.discount, shipping: r.shipping,
  bulky: r.bulky, grand: r.grand,
  discountPlaced: r.discount_placed != null ? r.discount_placed : r.discount,
  payMethod: r.pay_method,
  paid: r.paid, paidAt: r.paid_at, paidVia: r.paid_via,
  paidAmount: r.paid_amount != null ? r.paid_amount : (r.paid ? r.grand : null),
  refunded: r.refunded || 0, refundedAt: r.refunded_at || null,
  gatewayRef: null,
  // Placed online IS sent: the order reached the shop the moment it was.
  sent: true, sentAt: r.placed_at, sentVia: 'online',
  shipment: r.shipment || null,
  deliveredAt: r.delivered_at || null,
  arrives: r.arrives_from
    ? { from: r.arrives_from, to: r.arrives_to, ...(r.arrives_rule || {}) } : null,
  history: r.history || [],
});

const SELECT = '*, order_lines(*)';

async function fetchOrders(narrow) {
  // No session yet means nothing to see. Browsing never makes one.
  if (!(await session())) return [];
  const sb = await client();
  const { data, error } = await narrow(sb.from('orders').select(SELECT));
  oops(error);
  return (data || []).map(toApp);
}
const one = async (id) => (await fetchOrders((q) => q.eq('id', id)))[0];

// ---------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------
export const orders = {
  /** This visitor's own orders -- not every order a store session can see,
   *  or the owner would find the whole shop under "Your orders". */
  async mine() {
    // ⚠️ No session stored, no orders -- answered WITHOUT loading the
    // library. The bag page asks this for its suggestions (8 November 2026),
    // and a visitor who has never ordered must not download supabase-js
    // just to browse: "browsing never touches the server". If storage
    // cannot be read, the library is asked, as before.
    try { if (localStorage.getItem('vastra.auth') === null) return []; } catch (e) { /* ask */ }
    const s = await session();
    if (!s) return [];
    return fetchOrders((q) => q.eq('user_id', s.user.id).order('placed_at', { ascending: false }));
  },

  /** Everything the rules let this session see: every order, for the store;
   *  one's own, for anybody else. The board asks for this. */
  async all() {
    return fetchOrders((q) => q.order('placed_at', { ascending: false }));
  },

  async byCode(code) {
    return (await fetchOrders((q) => q.eq('code', String(code || '')).limit(1)))[0];
  },

  /**
   * Place it: the order goes to the shop now, in one call. The bag is read
   * from this browser and the totals worked out by domain.js, exactly as in
   * one-browser mode; place_order() on the server re-adds them, refuses any
   * that do not add up, and sets everything a customer must not choose.
   */
  async place(draft) {
    await begin();
    const [lines, shop, coupon, all] = await Promise.all([
      local.cart.lines(), local.catalog.shop(), local.cart.coupon(), local.catalog.all(),
    ]);
    if (!lines.length) throw new Error('EMPTY_BAG');
    const byId = (id) => all.find((p) => p.id === id);
    if (lines.some((l) => !byId(l.pid))) throw new Error('GONE_FROM_CATALOGUE');
    const t = D.totals(lines, byId, shop.shipping, coupon);

    const res = await rpcOrGone('place_order', { p: {
      customer: draft.customer,
      payMethod: draft.payMethod,
      lines: lines.map((l) => {
        const p = byId(l.pid);
        return {
          pid: p.id, name: p.name, slug: p.slug, variant: l.variant || {},
          variantLabel: D.variantLabel(p, l.variant), qty: l.qty,
          unitPrice: D.variantPrice(p, l.variant), unitMrp: D.variantMrp(p, l.variant),
        };
      }),
      itemsTotal: t.items, discount: t.discount, shipping: t.shipping,
      bulky: t.bulky, grand: t.grand,
      coupon: t.couponOk && coupon ? coupon.code : null,
      // ⚠️ THE DELIVERY PROMISE IS MADE HERE, because this is the moment the
      // order reaches the shop. The server freezes it and nothing moves it.
      arrives: D.arrivalPromise(shop.shipping),
    } });

    await local.cart.clear();
    await local.cart.clearCoupon();
    fire('orders');
    return orders.byCode(res.code);
  },

  /** Nothing to move: an order placed online was sent the moment it was. */
  async markSent(id) { return one(id); },

  /** The store moved it along. The server refuses an invalid step. */
  async advance(id, to) {
    await rpc('advance_order', { p_oid: id, p_to: to });
    fire('orders');
    return one(id);
  },

  /** -> shipped, with the courier and tracking number if the store has them. */
  async ship(id, { courier = '', ref = '' } = {}) {
    await rpc('advance_order', { p_oid: id, p_to: 'shipped', p_courier: courier, p_ref: ref });
    fire('orders');
    return one(id);
  },

  /** A person at the shop has seen the money arrive. Staff only, on the server. */
  async setPaid(id, isPaid, via) {
    await rpc('set_paid', { p_oid: id, p_paid: !!isPaid, p_via: via || null });
    fire('orders');
    return one(id);
  },

  /** ONE item moved, or cancelled. The server moves the order after it
   *  (roll_up_order) and re-adds the money when an item is cancelled. */
  async advanceLine(id, lineId, to, { courier = '', ref = '' } = {}) {
    await rpc('advance_line', { p_line: lineId, p_to: to, p_courier: courier, p_ref: ref });
    fire('orders');
    return one(id);
  },

  /** The store moves the order BACK to an earlier step (a wrong tap). Items
   *  at the order's step go back with it; an item further along on its own
   *  stays. step_back_order() refuses anything but an earlier road step. */
  async stepBack(id, to) {
    await rpc('step_back_order', { p_oid: id, p_to: to });
    fire('orders');
    return one(id);
  },

  /** ONE item back to an earlier step; the order follows it down if it is
   *  now the slowest (roll_up_order). */
  async stepBackLine(id, lineId, to) {
    await rpc('step_back_line', { p_line: lineId, p_to: to });
    fire('orders');
    return one(id);
  },

  /** A person at the shop has sent back what is owed. A note, like `paid`:
   *  nothing here sends money. Returns the amount marked refunded. */
  async markRefund(id) {
    const amount = await rpc('mark_refund', { p_oid: id });
    fire('orders');
    return Number(amount) || 0;
  },

  /** No gateway is configured, and a browser-reported payment id would be
   *  forgeable anyway. See gateway-razorpay.js. */
  async recordGatewayClaim() { throw new Error('GATEWAY_NOT_CONFIGURED'); },

  async clear() { throw new Error('Orders on the server are not cleared from a browser.'); },
};

// ---------------------------------------------------------------------
// LIVE. 'orders' comes from the database, so the board ticks when a phone
// places one. 'session', 'addresses' and 'details' are this file's own
// news -- who is signed in, the address book after a change, the account's
// name and mobile -- told to whoever listens. Everything else is this
// browser's and stays on its bus.
// ---------------------------------------------------------------------
const OWN = ['orders', 'session', 'addresses', 'details', 'reviews'];
const subs = new Map();
let channel = null;

function fire(topic) {
  for (const cb of subs.get(topic) || []) {
    try { cb(); } catch (e) { console.error('[vastra] subscriber', topic, e); }
  }
}

function openChannel() {
  if (channel) return;
  channel = client().then((sb) => sb.channel('vastra-orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' },
        () => fire('orders'))
    .subscribe())
    .catch((e) => { channel = null; console.error('[vastra] live updates', e); });
}

export const live = {
  subscribe(topic, cb) {
    if (!OWN.includes(topic)) return local.live.subscribe(topic, cb);
    if (topic === 'orders') openChannel();
    if (!subs.has(topic)) subs.set(topic, new Set());
    subs.get(topic).add(cb);
    return () => { const s = subs.get(topic); if (s) s.delete(cb); };
  },
};

/** This browser's own things, and nothing more. An order placed is with the
 *  shop, and not this browser's to delete; the session stays as well, so
 *  "Your orders" still opens what was placed. */
export async function clearEverything() { return local.clearEverything(); }

// ---------------------------------------------------------------------
// THE STORE'S DOOR
// ---------------------------------------------------------------------
export const staff = {
  /** Is this session the store? Asked of the server, the one place that knows. */
  async isStaff() {
    await begin();
    return !!(await rpc('is_staff'));
  },
  /**
   * Try the store code. True lets this session in, for good.
   * ⚠️ claim_staff() checks it on the server against a bcrypt hash. Nothing on
   * this page can tell a right code from a wrong one, and nothing should: a
   * page that could would be a page anybody could read the answer out of.
   */
  async claim(code) {
    await begin();
    const args = { p_code: String(code || '').trim().toLowerCase() };
    try {
      return !!(await rpc('claim_staff', args));
    } catch (e) {
      // The account behind this browser's session was deleted after the
      // check above said it was there (or the check could not be made):
      // out of it, a fresh guest session, and the code once more.
      if (!refusedAsGone(e)) throw e;
      await dropSession();
      await begin();
      return !!(await rpc('claim_staff', args));
    }
  },
};

// ---------------------------------------------------------------------
// THE CUSTOMER'S ACCOUNT (step 7) -- an email and a six-digit code, never
// a password. Nobody is made to do this: a guest orders exactly as before.
// What signing in buys is that their orders and addresses stop being tied
// to one phone.
//
// Two roads, chosen by whether the email is new to the shop (Milan's,
// kirana/app/backend-supabase.js, walked end to end there):
//
//   NEW EMAIL    The guest session this phone has -- or gets now -- takes
//                the email. Supabase calls that an email change and sends
//                the Change Email Address template. Same user, so every
//                order placed here is the account's already.
//   KNOWN EMAIL  An account made on another phone. This phone signs in AS
//                it (the Magic Link template) and so becomes a different
//                user. A hand-over ticket, made first while it is still
//                the guest, carries its orders across; schema.sql says why
//                a ticket and not a user id.
//
// ⚠️ Both templates must carry {{ .Token }} and not the link, or the code
// never arrives: db/SETUP.md step 7.
// ---------------------------------------------------------------------
const taken = (e) => !!e && (e.code === 'email_exists'
  || /already (been )?registered|already exists/i.test(e.message || ''));

const cleanEmail = (e) => String(e || '').trim().toLowerCase();

// The ticket, held between "send me a code" and "here it is". Memory only:
// a reload in between means asking for a new code, which makes a new one.
let handover = null;

export const account = {
  /** Who this phone is: null (no session yet), a guest, or an account.
   *  Read from the session this browser holds, asked of the server once per
   *  token whether its account still exists (liveSession) -- a phone must
   *  not go on saying "Signed in" to an account that was deleted -- and
   *  decides only what the page offers. The server asks auth.users for
   *  itself. */
  async whoami() {
    const s = await liveSession();
    if (!s) return null;
    const u = s.user || {};
    const m = u.user_metadata || {};
    return { id: u.id, email: u.email || null, guest: !!u.is_anonymous || !u.email,
             name: String(m.name || ''), mobile: String(m.mobile || '') };
  },

  /**
   * The account's own name and mobile (8 November 2026: "a profile … to edit
   * things"), kept on the account itself -- Supabase's user_metadata, which
   * only its owner may change -- so they follow the person to any phone and
   * fill in a new address there. Never used to decide anything: the server
   * reads auth.users for who someone is, not this.
   */
  async saveDetails({ name = '', mobile = '' } = {}) {
    const sb = await client();
    const { error } = await sb.auth.updateUser({ data: {
      name: String(name).trim().slice(0, 80),
      mobile: String(mobile).replace(/\D/g, '').slice(-10),
    } });
    oops(error);
    fire('details');
    return account.whoami();
  },

  /** Mail a code. Returns the road taken, which verifyCode() needs back. */
  async sendCode(email) {
    const addr = cleanEmail(email);
    await begin();
    const sb = await client();
    const s = await session();
    handover = null;
    if (s && s.user && s.user.is_anonymous) {
      const { error } = await sb.auth.updateUser({ email: addr });
      if (!error) return { mode: 'upgrade', email: addr };
      if (!taken(error)) oops(error);
      // A ticket for this phone's guest orders. If one cannot be made the
      // sign-in still goes ahead: the orders stay with the guest session,
      // and the store has every one of them either way.
      try { handover = await rpc('make_handover'); } catch (e) {
        console.warn('[vastra] hand-over ticket', e);
      }
    }
    // shouldCreateUser: false -- this road is for an account that exists.
    // A new email always takes the road above, so nothing is ever created
    // here, and the Confirm Signup template is never involved.
    const { error } = await sb.auth.signInWithOtp({
      email: addr, options: { shouldCreateUser: false },
    });
    oops(error);
    return { mode: 'signin', email: addr };
  },

  /** The code, checked by Supabase. Returns who this phone now is, and how
   *  many guest orders came across with it. */
  async verifyCode(email, code, mode) {
    const sb = await client();
    const { error } = await sb.auth.verifyOtp({
      email: cleanEmail(email),
      token: String(code || '').replace(/\D/g, ''),
      // 'email_change' confirms an email just given to the guest session;
      // 'email' signs in to an account that already had it.
      type: mode === 'upgrade' ? 'email_change' : 'email',
    });
    oops(error);
    let moved = 0;
    if (mode === 'signin' && handover) {
      try { moved = Number(await rpc('take_handover', { p_token: handover })) || 0; } catch (e) {
        console.warn('[vastra] hand-over', e);
      }
    }
    handover = null;
    fire('session');
    fire('orders');
    return { ...(await account.whoami()), moved };
  },

  async signOut() {
    const sb = await client();
    // ⚠️ 'local': THIS phone. supabase-js signs out of every phone the
    // person is signed in on unless told otherwise, and the button does
    // not say that.
    await sb.auth.signOut({ scope: 'local' });
    handover = null;
    // The details checkout fills in go with the person: a shared phone must
    // not hand the next customer someone else's address.
    await local.profile.clear();
    fire('session');
    fire('orders');
  },
};

// ---------------------------------------------------------------------
// THE ADDRESS BOOK -- accounts only (a guest's details stay in this
// browser), read under the rule that shows each person their own, and
// every write a function on the server that checks it again.
// ---------------------------------------------------------------------
const addrToApp = (r) => ({
  id: r.id, name: r.name, mobile: r.mobile, addr: r.addr,
  city: r.city, state: r.state, pin: r.pin, isDefault: !!r.is_default,
});

export const addresses = {
  /** The default first, then the newest. */
  async list() {
    const s = await session();
    if (!s || !s.user || s.user.is_anonymous) return [];
    const sb = await client();
    const { data, error } = await sb.from('addresses').select('*')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    oops(error);
    return (data || []).map(addrToApp);
  },

  /** New without an id, a change with one. Returns the id. */
  async save(a) {
    const id = await rpcOrGone('save_address', { p: {
      id: a.id || null, name: a.name, mobile: a.mobile, addr: a.addr,
      city: a.city, state: a.state, pin: a.pin, isDefault: !!a.isDefault,
    } });
    fire('addresses');
    return id;
  },

  async makeDefault(id) {
    await rpc('set_default_address', { p_id: id });
    fire('addresses');
  },

  async remove(id) {
    await rpc('delete_address', { p_id: id });
    fire('addresses');
  },
};

// ---------------------------------------------------------------------
// REVIEWS (8 November 2026). Once an item is delivered its customer may
// rate it, and rate the delivery; each product's average and its reviews
// are shown to everybody, and the store sees all of it.
//
// ⚠️ WHAT EVERYBODY READS COMES WITHOUT A SESSION AND WITHOUT THE LIBRARY.
// A product page is open to anyone, and browsing makes no session: the two
// public functions (granted to anon in db/schema.sql, and nothing else is)
// are asked with the publishable key alone, by a plain fetch -- so a
// visitor who only looks never downloads supabase-js. Writing a review is a
// signed-in customer's call like any other.
// ---------------------------------------------------------------------
async function publicRpc(fn, args = {}) {
  const res = await fetch(`${SUPABASE.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn} ${res.status}`);
  return res.json();
}

const reviewToApp = (r) => ({
  id: r.id, lineId: r.line_id, orderId: r.order_id, pid: r.pid,
  rating: r.rating, comment: r.body || '', author: r.author || '',
  hidden: !!r.hidden, at: r.updated_at || r.created_at,
});

export const reviews = {
  /** { pid: { average, ratings } } for every product with a review on show. */
  async summary() {
    const out = {};
    for (const r of (await publicRpc('rating_summary')) || []) {
      out[r.pid] = { average: Number(r.average), ratings: Number(r.ratings) };
    }
    return out;
  },

  /** A product's reviews on show, newest first: stars, words, "Asha M.". */
  async forProduct(pid) {
    return ((await publicRpc('product_reviews', { p_pid: pid })) || []).map((r) => ({
      rating: r.rating, comment: r.body || '', author: r.author || '', at: r.created_at,
    }));
  },

  /** This customer's own ratings on one order, to show what they gave. */
  async mine(orderId) {
    const none = { delivery: null, lines: {} };
    if (!(await session())) return none;
    const sb = await client();
    const [a, b] = await Promise.all([
      sb.from('reviews').select('*').eq('order_id', orderId),
      sb.from('delivery_ratings').select('*').eq('order_id', orderId),
    ]);
    oops(a.error);
    oops(b.error);
    const lines = {};
    for (const r of a.data || []) lines[r.line_id] = reviewToApp(r);
    const d = (b.data || [])[0];
    return { delivery: d ? { rating: d.rating, comment: d.body || '', courier: d.courier || '' } : null,
             lines };
  },

  async submit(lineId, rating, comment) {
    const id = await rpcOrGone('submit_review',
      { p_line: lineId, p_rating: rating, p_body: String(comment || '') });
    fire('reviews');
    return id;
  },

  async rateDelivery(orderId, rating, comment) {
    await rpcOrGone('rate_delivery',
      { p_oid: orderId, p_rating: rating, p_body: String(comment || '') });
    fire('reviews');
  },

  /** The store: every review, hidden ones too, and every delivery rating. */
  async all() {
    const sb = await client();
    const [a, b] = await Promise.all([
      sb.from('reviews').select('*').order('created_at', { ascending: false }),
      sb.from('delivery_ratings').select('*').order('created_at', { ascending: false }),
    ]);
    oops(a.error);
    oops(b.error);
    return {
      products: (a.data || []).map(reviewToApp),
      deliveries: (b.data || []).map((d) => ({
        orderId: d.order_id, rating: d.rating, comment: d.body || '', courier: d.courier || '',
        at: d.updated_at || d.created_at,
      })),
    };
  },

  /** The store takes a review out of the shop, or puts it back. */
  async hide(id, hidden) {
    await rpc('hide_review', { p_id: id, p_hidden: !!hidden });
    fire('reviews');
  },
};
