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

async function session() {
  const sb = await client();
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

/**
 * A session for this visitor, made silently if there is none. Anonymous:
 * nobody is asked to sign in to buy a shirt, and every order still has an
 * owner, which is what lets each read rule be one line. Signing in with an
 * email (account, below) makes this SAME user permanent, so the orders
 * placed before it stay theirs.
 */
export async function begin() {
  const s = await session();
  if (s) return s;
  const sb = await client();
  const { data, error } = await sb.auth.signInAnonymously();
  oops(error);
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
  lines: (r.order_lines || []).slice().sort((a, b) => a.id - b.id).map((l) => ({
    pid: l.pid, name: l.name, slug: l.slug, variant: l.variant || {},
    variantLabel: l.variant_label || '', qty: l.qty,
    unitPrice: l.unit_price, unitMrp: l.unit_mrp, lineTotal: l.line_total,
  })),
  itemsTotal: r.items_total, mrpTotal: r.mrp_total, saved: r.saved,
  coupon: r.coupon, discount: r.discount, shipping: r.shipping,
  bulky: r.bulky, grand: r.grand,
  payMethod: r.pay_method,
  paid: r.paid, paidAt: r.paid_at, paidVia: r.paid_via,
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

    const res = await rpc('place_order', { p: {
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

  /** No gateway is configured, and a browser-reported payment id would be
   *  forgeable anyway. See gateway-razorpay.js. */
  async recordGatewayClaim() { throw new Error('GATEWAY_NOT_CONFIGURED'); },

  async clear() { throw new Error('Orders on the server are not cleared from a browser.'); },
};

// ---------------------------------------------------------------------
// LIVE. 'orders' comes from the database, so the board ticks when a phone
// places one. 'session' and 'addresses' are this file's own news -- who
// is signed in, and the address book after a change -- told to whoever
// listens. Everything else is this browser's and stays on its bus.
// ---------------------------------------------------------------------
const OWN = ['orders', 'session', 'addresses'];
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
    return !!(await rpc('claim_staff', { p_code: String(code || '').trim().toLowerCase() }));
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
   *  Read from the session this browser holds -- no request -- and decides
   *  only what the page offers. The server asks auth.users for itself. */
  async whoami() {
    const s = await session();
    if (!s) return null;
    const u = s.user || {};
    return { id: u.id, email: u.email || null, guest: !!u.is_anonymous || !u.email };
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
    const id = await rpc('save_address', { p: {
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
