// ============================================================================
// DEVI Collections — the local backend. localStorage plus cross-tab events.
//
// THE CONTRACT. Every backend must obey all four, because store.js swaps
// between them on one import line and nothing downstream may notice:
//
//   1. EVERY METHOD IS async, even when it is answered from memory. A method
//      that is sync today and a network call tomorrow changes every call site.
//   2. RETURNS ARE DEEP-CLONED. Handing out a reference into the store lets a
//      caller mutate it without going through a write, and the change then
//      survives until a reload and vanishes after it.
//   3. IDS ARE MINTED BY THE BACKEND. Never by the UI.
//   4. live.subscribe RETURNS AN UNSUBSCRIBE FUNCTION. A screen that forgets
//      it fires N times after N visits.
//
// A fifth, quieter rule: this file imports nothing secret, so the app runs
// with no credentials file at all.
// ============================================================================

import * as D from './domain.js';
import * as O from './overlay.js';

const K = {
  cart: 'devi.cart',
  coupon: 'devi.coupon',
  wish: 'devi.wishlist',
  orders: 'devi.orders',
  seq: 'devi.seq',
  profile: 'devi.profile',
  ui: 'devi.ui',
  // The admin's field-level patches over the shipped catalogue. See overlay.js
  // for why this is a patch set and not a copy of the catalogue.
  overrides: 'devi.catalog.overrides',
  rev: 'devi.rev.',
};

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    // A private window, blocked site data, or a half-written value. An empty
    // store is a correct answer here; throwing is not.
    return fallback;
  }
}

function write(key, value, topic) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // ⚠️ Quota. localStorage is about 5 MB. This must not fail silently --
    // kirana's equivalent swallows it, and the symptom is a cart that forgets
    // one item in twenty with no error anywhere.
    console.error('[devi] could not save', key, e);
    bus.emit('quota', { key });
    return false;
  }
  if (topic) bump(topic);
  return true;
}

// ---------------------------------------------------------------------------
// CROSS-TAB FAN-OUT
//
// ⚠️ The `storage` event fires in every OTHER tab of the origin and
// deliberately NOT in the one that wrote. So a single path cannot serve both:
// the writer has to notify itself directly.
//
// The revision carries a random tail so two writes in the same millisecond
// still differ, and so an identical value still counts as a change.
// ---------------------------------------------------------------------------
const bus = {
  subs: new Map(),
  on(topic, fn) {
    if (!this.subs.has(topic)) this.subs.set(topic, new Set());
    this.subs.get(topic).add(fn);
    return () => this.subs.get(topic).delete(fn);   // contract rule 4
  },
  emit(topic, payload) {
    const s = this.subs.get(topic);
    if (s) for (const fn of Array.from(s)) { try { fn(payload); } catch (e) { console.error(e); } }
  },
};

function bump(topic) {
  const tag = Date.now() + ':' + Math.random().toString(36).slice(2, 8);
  try { localStorage.setItem(K.rev + topic, tag); } catch { /* quota: see write() */ }
  bus.emit(topic);                                  // the writer notifies itself
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith(K.rev)) bus.emit(e.key.slice(K.rev.length));
  });
}

// ---------------------------------------------------------------------------
// CATALOGUE — loaded once, held in memory, then overlaid.
//
// SHIPPED_* is app/data/*.json exactly as it arrived: reviewed, in version
// control, and never written to. CAT and CATS are what the shop actually
// shows, which is SHIPPED_* with the admin's field-level patches laid over it.
//
// ⚠️ Keeping both is the point. A patch is a diff AGAINST the shipped value,
// so computing one needs the shipped value to still be here. Collapse these
// into one and every edit pins every field it touched for ever -- see the
// header of overlay.js.
// ---------------------------------------------------------------------------
let CAT = null, SHOP = null, CATS = null, PAGES = null;
let SHIPPED = null, SHIPPED_CATS = null, SHIPPED_CATS_FILE = null;
let readyP = null;

/** The data files exactly as they arrived, when there was a server. */
const RAW = Object.create(null);

async function loadJSON(path) {
  // ⚠️ The single-file build (tools/mksingle.pl) has no server to fetch
  // from, so it defines __DEVI_DATA with the four data files already in it.
  // The check lives HERE, in the real source, rather than the bundler
  // rewriting this function -- so the served app and the single file run
  // byte-identical code and cannot drift apart. Cloned on the way out for
  // the same reason every other read is: a caller that mutates what it got
  // must not poison the only copy.
  const inline = globalThis.__DEVI_DATA && globalThis.__DEVI_DATA[path];
  if (inline) return JSON.parse(JSON.stringify(inline));

  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path} returned ${r.status}`);
  const text = await r.text();
  // Keep the bytes as they arrived. The admin's canonical self-check needs to
  // compare its own encoding against the real file, and this is the only place
  // the file is ever read -- a second fetch there would be a second way for
  // the single-file build to try to reach a server that is not there, which is
  // exactly what mksingle.pl's "nothing is still fetched" guard exists to
  // prevent. Costs about 85 KB of held text, against a 414 KB page.
  RAW[path] = text;
  return JSON.parse(text);
}

export function ready() {
  if (!readyP) {
    readyP = (async () => {
      const [cl, cats, shop, pages] = await Promise.all([
        loadJSON('data/catalog.json'),
        loadJSON('data/categories.json'),
        loadJSON('data/shop.json'),
        loadJSON('data/pages.json'),
      ]);
      SHIPPED = cl;
      // Both the whole file and the list: the export has to put back `note`
      // and `rev`, and dropping either makes the first export a diff that
      // deletes them -- which canon.pl would pass and nobody would notice.
      SHIPPED_CATS_FILE = cats;
      SHIPPED_CATS = cats.categories;
      SHOP = shop;
      PAGES = pages.pages;
      recompute();
      return true;
    })();
  }
  return readyP;
}

const readOverlay = () => {
  const ov = read(K.overrides, null);
  return ov && typeof ov === 'object' && ov.patch ? ov : null;
};

/**
 * Rebuild what the shop sees. Called at load and after every admin edit.
 *
 * ⚠️ A STALE overlay is NOT applied. When the shipped catalogue has moved on,
 * patches written against the old one are held back until a human has looked
 * at them -- reverting the shop to the reviewed file, which is the safe
 * direction. The admin shows the review; overlay.js explains why.
 */
function recompute() {
  const ov = readOverlay();
  const state = O.overlayState(SHIPPED.rev, ov);
  const live = state === 'current';
  CAT = live ? O.applyOverlay(SHIPPED.products, ov) : SHIPPED.products.slice();
  CATS = live ? O.applyCatOverlay(SHIPPED_CATS, ov) : SHIPPED_CATS.slice();
  return state;
}

/** Read, mutate, persist, re-overlay, fan out. Every admin write goes here. */
function writeOverlay(mutate) {
  const ov = readOverlay() || O.emptyOverlay(SHIPPED.rev);
  mutate(ov);
  ov.at = D.nowStamp();
  write(K.overrides, ov, 'catalog');
  recompute();
  return clone(ov);
}

/** Where two strings first diverge, with context. For the canonical check. */
function firstDiffAt(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return { at: i, mine: a.slice(i, i + 48), theirs: b.slice(i, i + 48) };
}

const byIdSync = (id) => CAT.find((p) => p.id === id);
const shippedById = (id) => SHIPPED.products.find((p) => p.id === id);

export const catalog = {
  async all() { return clone(CAT); },
  async byId(id) { return clone(byIdSync(id)); },
  async bySlug(slug) { return clone(CAT.find((p) => p.slug === slug)); },
  async categories() { return clone(CATS); },
  async shop() { return clone(SHOP); },
  async pages() { return clone(PAGES); },

  async byCat(cat, sub) {
    return clone(CAT.filter((p) => p.cat === cat && (!sub || p.sub === sub)));
  },
  async search(q) { return clone(D.searchProducts(CAT, q, CATS)); },

  async bestsellers(n = 8) {
    return clone(CAT.filter((p) => (p.badges || []).includes('bestseller'))
                    .sort((a, b) => b.popularity - a.popularity).slice(0, n));
  },
  async newArrivals(n = 8) {
    return clone(CAT.filter((p) => D.isNew(p, SHOP))
                    .sort((a, b) => b.addedOn.localeCompare(a.addedOn)).slice(0, n));
  },
  async onOffer(n = 8) {
    return clone(CAT.slice().sort((a, b) => D.discountPct(b) - D.discountPct(a)).slice(0, n));
  },
  async under(amount, n = 8) {
    return clone(CAT.filter((p) => p.price <= amount)
                    .sort((a, b) => b.popularity - a.popularity).slice(0, n));
  },
  async related(id, n = 4) {
    const p = byIdSync(id);
    return p ? clone(D.relatedTo(p, CAT, n)) : [];
  },
  /** Counts per subcategory, for the sidebar. */
  async counts() {
    const out = {};
    for (const p of CAT) {
      // A leaf category's products have no sub; counting them under the
      // literal key "undefined" would show 0 beside the only row that
      // has anything in it.
      if (p.sub) out[p.sub] = (out[p.sub] || 0) + 1;
      out[p.cat] = (out[p.cat] || 0) + 1;
    }
    return out;
  },

  // -------------------------------------------------------------------------
  // ADMIN. Everything below writes the overlay, never the shipped file.
  // -------------------------------------------------------------------------

  /** app/data/catalog.json exactly as it shipped. The baseline for a diff. */
  async shipped() { return clone(SHIPPED); },
  async shippedCategories() { return clone(SHIPPED_CATS); },
  async overlay() { return clone(readOverlay()); },
  async overlayState() { return O.overlayState(SHIPPED.rev, readOverlay()); },

  /**
   * Patch fields on one product.
   *
   * ⚠️ Anything equal to the shipped value is REMOVED from the patch rather
   * than stored. Without that, setting a price back to what it was would pin
   * it, and that field would never again pick up a catalogue update -- an edit
   * that looks like an undo but silently is not.
   */
  async patch(pid, fields) {
    const ov = readOverlay();
    const addedAt = (ov && ov.added || []).findIndex((p) => p.id === pid);
    if (addedAt !== -1) {
      // A product created here has no shipped baseline: it IS the record.
      return writeOverlay((o) => { Object.assign(o.added[addedAt], fields); });
    }
    const ship = shippedById(pid);
    if (!ship) throw new Error('NO_SUCH_PRODUCT ' + pid);
    return writeOverlay((o) => {
      const next = { ...(o.patch[pid] || {}), ...fields };
      for (const k of Object.keys(next)) {
        // An unset (null) of a field the shipped product never had is not
        // an edit. Without this, saving an unchanged table runner would
        // pin `sub: null` and show Filing as modified for ever.
        const noop = next[k] === null && !(k in ship);
        if (noop || O.sameValue(next[k], ship[k])) delete next[k];
      }
      if (Object.keys(next).length) o.patch[pid] = next; else delete o.patch[pid];
    });
  },

  async revertField(pid, fieldName) {
    return writeOverlay((o) => {
      if (!o.patch[pid]) return;
      delete o.patch[pid][fieldName];
      if (!Object.keys(o.patch[pid]).length) delete o.patch[pid];
    });
  },

  async revertProduct(pid) {
    return writeOverlay((o) => {
      delete o.patch[pid];
      o.retired = (o.retired || []).filter((id) => id !== pid);
      o.added = (o.added || []).filter((p) => p.id !== pid);
    });
  },

  /** Contract rule 3: the backend mints the id, never the UI. */
  async addProduct(draft) {
    const base = 'p-new-' + String(draft.slug || 'product')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
    const taken = new Set([
      ...SHIPPED.products.map((p) => p.id),
      ...((readOverlay() || {}).added || []).map((p) => p.id),
    ]);
    let id = base, n = 1;
    while (taken.has(id)) id = `${base}-${++n}`;
    const product = { ...draft, id };
    writeOverlay((o) => { o.added.push(product); });
    return clone(product);
  },

  /**
   * Retire, never delete. A product id may sit in somebody's cart, wishlist
   * or a placed order, and all three resolve by id. Retiring takes it off the
   * shop; deleting the record would make those lines render as blanks.
   */
  async retire(pid) {
    return writeOverlay((o) => {
      if (!(o.retired || []).includes(pid)) o.retired.push(pid);
    });
  },
  async unretire(pid) {
    return writeOverlay((o) => { o.retired = (o.retired || []).filter((id) => id !== pid); });
  },

  async patchCategory(cid, fields) {
    const ship = SHIPPED_CATS.find((c) => c.id === cid);
    if (!ship) throw new Error('NO_SUCH_CATEGORY ' + cid);
    return writeOverlay((o) => {
      const next = { ...((o.catPatch || {})[cid] || {}), ...fields };
      for (const k of Object.keys(next)) {
        if (O.sameValue(next[k], ship[k])) delete next[k];
      }
      o.catPatch = o.catPatch || {};
      if (Object.keys(next).length) o.catPatch[cid] = next; else delete o.catPatch[cid];
    });
  },

  /** What a stale overlay would do against the catalogue now loaded. */
  async reconcile() {
    return O.reconcile(SHIPPED.products, readOverlay() || O.emptyOverlay(SHIPPED.rev));
  },

  /** Drop the patches the new catalogue already agrees with. */
  async dropAgreed() {
    const ov = readOverlay();
    if (!ov) return null;
    const { agreed } = O.reconcile(SHIPPED.products, ov);
    const next = O.dropAgreed(ov, agreed);
    if (O.countEdits(next) === 0) {
      // Nothing left to argue about: the shipped file now says everything the
      // overlay did, so the overlay has done its job and retires itself.
      try { localStorage.removeItem(K.overrides); } catch { /* see write() */ }
      bump('catalog'); recompute();
      return null;
    }
    next.at = D.nowStamp();
    write(K.overrides, next, 'catalog');
    recompute();
    return clone(next);
  },

  /** Keep my edits and re-stamp them against the catalogue now loaded. */
  async keepMine() {
    return writeOverlay((o) => { o.rev = SHIPPED.rev; });
  },

  async clearOverlay() {
    try { localStorage.removeItem(K.overrides); } catch { /* see write() */ }
    bump('catalog');
    recompute();
    return null;
  },

  /** The two files that go back into app/data/. Canonical, byte for byte. */
  async exportCatalog() { return O.canonicalJSON(O.exportCatalog(SHIPPED, CAT)); },
  async exportCategories() {
    return O.canonicalJSON(O.exportCategories(SHIPPED_CATS_FILE, CATS));
  },

  /**
   * Prove this file's canonical form and tools/canon.pl agree, by re-encoding
   * the shipped data and checking the result is byte-for-byte what arrived.
   *
   * ⚠️ This is a real check, not a formality. canon.pl passes on the shipped
   * files, so they ARE canonical by Perl's definition. If re-encoding them
   * here reproduces them exactly, then both sides agree and the first export
   * is a diff of real changes rather than 2,700 reformatted lines. If they
   * ever drift, this says so in the admin instead of the owner finding out
   * from an unreviewable pull request.
   *
   * Needs the raw bytes, which exist only where there was a server to fetch
   * them from. In the single-file build RAW is empty and this says so rather
   * than guessing, or inventing a second fetch to go and find them.
   */
  async canonSelfCheck() {
    return [
      ['catalog.json', SHIPPED], ['categories.json', SHIPPED_CATS_FILE],
    ].map(([name, value]) => {
      // ⚠️ Reversed first, deliberately. See reverseKeys() in overlay.js: the
      // shipped files are already sorted, so encoding them straight would
      // reproduce them even with the sort removed, and this check would pass
      // while proving nothing. Measured.
      const mine = O.canonicalJSON(O.reverseKeys(value));
      const raw = RAW['data/' + name];
      return {
        name,
        comparable: typeof raw === 'string',
        ok: typeof raw === 'string' ? mine === raw : null,
        bytes: mine.length,
        firstDiff: typeof raw === 'string' && mine !== raw ? firstDiffAt(mine, raw) : null,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// CART
//
// ⚠️ A cart line is { pid, qty, variant } AND NOTHING ELSE. No price. A cart
// that stores a price disagrees with itself the moment anyone edits one, and
// it surfaces as "the cart total isn't the checkout total" -- unfixable once
// there are two sources of truth. Price resolves from the catalogue at render
// and is snapshotted into the order line at placement, the one moment it must
// freeze.
// ---------------------------------------------------------------------------
const readCart = () => read(K.cart, []);

export const cart = {
  async lines() { return clone(readCart()); },

  async count() {
    return readCart().reduce((n, l) => n + l.qty, 0);
  },

  async add(pid, qty = 1, variant = {}) {
    const lines = readCart();
    const key = D.lineKey({ pid, variant });
    const at = lines.findIndex((l) => D.lineKey(l) === key);
    if (at === -1) lines.push({ pid, qty, variant });
    else lines[at].qty += qty;
    write(K.cart, lines, 'cart');
    return clone(lines);
  },

  async setQty(key, n) {
    const lines = readCart();
    const at = lines.findIndex((l) => D.lineKey(l) === key);
    if (at === -1) return clone(lines);
    if (n <= 0) lines.splice(at, 1); else lines[at].qty = n;
    write(K.cart, lines, 'cart');
    return clone(lines);
  },

  async remove(key) {
    const lines = readCart().filter((l) => D.lineKey(l) !== key);
    write(K.cart, lines, 'cart');
    return clone(lines);
  },

  async clear() { write(K.cart, [], 'cart'); return []; },

  async coupon() {
    // Re-matched on every READ, not trusted from storage: a code withdrawn in
    // shop.json since it was applied must stop applying immediately.
    return clone(D.matchCoupon(read(K.coupon, ''), SHOP.coupons));
  },

  async applyCoupon(code) {
    const c = D.matchCoupon(code, SHOP.coupons);
    if (!c) return { ok: false, reason: 'That code is not valid.' };
    const t = await cart.totals();
    if (t.items < (c.minItems || 0)) {
      return { ok: false,
               reason: `${c.code} needs a basket of ${D.rupees(c.minItems)} or more.` };
    }
    write(K.coupon, c.code, 'cart');
    return { ok: true, coupon: clone(c) };
  },

  async clearCoupon() { write(K.coupon, '', 'cart'); },

  async totals() {
    const c = D.matchCoupon(read(K.coupon, ''), SHOP.coupons);
    return D.totals(readCart(), byIdSync, SHOP.shipping, c);
  },
};

// ---------------------------------------------------------------------------
// WISHLIST — ids only, for the same reason the cart stores no price.
// ---------------------------------------------------------------------------
export const wishlist = {
  async ids() { return clone(read(K.wish, [])); },
  async has(pid) { return read(K.wish, []).includes(pid); },
  async toggle(pid) {
    const ids = read(K.wish, []);
    const at = ids.indexOf(pid);
    if (at === -1) ids.push(pid); else ids.splice(at, 1);
    write(K.wish, ids, 'wishlist');
    return at === -1;
  },
  async clear() { write(K.wish, [], 'wishlist'); },
  async products() {
    const ids = read(K.wish, []);
    return clone(ids.map(byIdSync).filter(Boolean));
  },
};

// ---------------------------------------------------------------------------
// ORDERS
//
// ⚠️ place() NEVER sets paid, and NEVER sets a status other than 'draft'.
// An order the merchant has never seen is not placed. tools/honesty.pl fails
// on any code that tries.
// ---------------------------------------------------------------------------
export const orders = {
  async mine() {
    return clone(read(K.orders, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  },

  async byCode(code) {
    return clone(read(K.orders, []).find((o) => o.code === code));
  },

  async place(draft) {
    const all = read(K.orders, []);
    const seq = (read(K.seq, 0) || 0) + 1;              // contract rule 3
    const code = 'DC-' + String(seq).padStart(4, '0');

    // Re-resolve everything from the catalogue rather than trusting the cart.
    const lines = readCart().map((l) => {
      const p = byIdSync(l.pid);
      const unit = D.variantPrice(p, l.variant);
      return {
        pid: p.id, name: p.name, slug: p.slug, sub: p.sub, kind: p.kind,
        variant: clone(l.variant),
        variantLabel: D.variantLabel(p, l.variant),
        qty: l.qty,
        unitPrice: unit,
        unitMrp: D.variantMrp(p, l.variant),
        lineTotal: unit * l.qty,
      };
    });

    // ⚠️ Re-match the coupon AND re-check its thresholds at placement. kirana
    // re-matches the code; that is not enough, because a basket can SHRINK
    // between applying a coupon and ordering.
    const coupon = D.matchCoupon(read(K.coupon, ''), SHOP.coupons);
    const t = D.totals(readCart(), byIdSync, SHOP.shipping, coupon);

    const now = D.nowStamp();
    const order = {
      id: `ord-${D.istDate()}-${String(seq).padStart(4, '0')}`,
      code,
      createdAt: now,
      customer: clone(draft.customer),
      lines,
      itemsTotal: t.items,
      mrpTotal: t.mrpTotal,
      saved: t.saved,
      coupon: t.couponOk && coupon ? coupon.code : null,
      discount: t.discount,
      shipping: t.shipping,
      bulky: t.bulky,
      grand: t.grand,
      payMethod: draft.payMethod,
      paid: false, paidAt: null, paidVia: null,
      gatewayRef: null,
      sent: false, sentAt: null, sentVia: null,
      status: 'draft',
      history: [{ at: now, to: 'draft' }],
    };

    all.push(order);
    write(K.orders, all, 'orders');
    write(K.seq, seq);
    write(K.cart, [], 'cart');
    write(K.coupon, '', 'cart');
    return clone(order);
  },

  /** The customer handed it over. draft -> sent. */
  async markSent(id, via) {
    return advance(id, 'sent', (o) => {
      o.sent = true; o.sentAt = D.nowStamp(); o.sentVia = via;
    });
  },

  /** An admin moved it along. Throws on an invalid transition. */
  async advance(id, to, note) { return advance(id, to, null, note); },

  /**
   * ⚠️ Razorpay's success handler returns razorpay_payment_id IN THE BROWSER,
   * which is forgeable. Verifying it needs an HMAC over the key secret, which
   * cannot exist in a static page. So a gateway claim is RECORDED and
   * explicitly NOT TRUSTED: verified stays false and paid is untouched.
   */
  async recordGatewayClaim(id, paymentId, provider) {
    const all = read(K.orders, []);
    const o = all.find((x) => x.id === id);
    if (!o) throw new Error('NO_SUCH_ORDER');
    o.gatewayRef = { provider, paymentId, at: D.nowStamp(), verified: false };
    write(K.orders, all, 'orders');
    return clone(o);
  },

  /**
   * The ONE place `paid` can become true, and it exists for one caller: the
   * admin, after a human has checked the bank. honesty.pl fails on any other
   * call site.
   */
  async setPaid(id, isPaid, via) {
    const all = read(K.orders, []);
    const o = all.find((x) => x.id === id);
    if (!o) throw new Error('NO_SUCH_ORDER');
    o.paid = !!isPaid;
    o.paidAt = isPaid ? D.nowStamp() : null;
    o.paidVia = isPaid ? (via || null) : null;
    write(K.orders, all, 'orders');
    return clone(o);
  },

  async clear() { write(K.orders, [], 'orders'); write(K.seq, 0); },
};

function advance(id, to, mutate, note) {
  const all = read(K.orders, []);
  const o = all.find((x) => x.id === id);
  if (!o) throw new Error('NO_SUCH_ORDER');
  // A silent no-op is a button that looks like it worked.
  if (!D.canAdvance(o.status, to)) {
    throw new Error(`BAD_TRANSITION ${o.status} -> ${to}`);
  }
  o.status = to;
  o.history.push({ at: D.nowStamp(), to, note: note || undefined });
  if (mutate) mutate(o);
  write(K.orders, all, 'orders');
  return clone(o);
}

// ---------------------------------------------------------------------------
// PROFILE — prefills checkout. NOT an account. There is no password here
// because there is no server to hold one.
// ---------------------------------------------------------------------------
export const profile = {
  async get() {
    return clone(read(K.profile, {
      name: '', mobile: '', email: '', addr: '', city: '', state: '', pin: '',
    }));
  },
  async save(p) { write(K.profile, clone(p), 'profile'); return clone(p); },
  async clear() { write(K.profile, null, 'profile'); },
};

// ---------------------------------------------------------------------------
// UI STATE — which sidebar groups are open. Survives a refresh.
// ---------------------------------------------------------------------------
export const ui = {
  async get() { return clone(read(K.ui, { expanded: [] })); },
  async save(v) { write(K.ui, clone(v)); return clone(v); },
};

/** The only "log out" there is when everything lives in one browser. */
export async function clearEverything() {
  for (const k of Object.values(K)) {
    if (k === K.rev) continue;
    // ⚠️ NOT the catalogue overlay. This button lives on the customer's
    // account screen and clears what the shop knows about THEM. The overlay
    // is the owner's unexported catalogue work -- hours of it, with no copy
    // anywhere else until it has been exported. The admin has its own
    // clearOverlay(), which says what it is about to throw away.
    if (k === K.overrides) continue;
    try { localStorage.removeItem(k); } catch { /* nothing to do */ }
  }
  for (const t of ['cart', 'wishlist', 'orders', 'profile']) bump(t);
}

export const live = {
  /** Returns the unsubscribe. Contract rule 4. */
  subscribe(topic, fn) { return bus.on(topic, fn); },
};
