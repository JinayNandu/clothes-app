// ============================================================================
// DEVI Collections — the pure domain.
//
// NO DOM, NO STORAGE, NO FETCH. Everything here is a function of its arguments,
// which is what makes the money rules and the route parser testable by a Perl
// script without a browser.
//
// EVERY DATE AND CLOCK READ IN THE PROJECT LIVES IN THIS FILE. tools/clock.pl
// greps every other module for date reads and fails on a hit.
//
// ⚠️ Why: `new Date().toISOString().slice(0,10)` is UTC. On an IST device
// between 00:00 and 05:30 it returns YESTERDAY, so anything keyed on it is
// wrong for five and a half hours every night — invisible in daylight, and the
// symptom is "the orders from last night have the wrong date". kirana carries
// the same rule for the same reason.
// ============================================================================

// ---------------------------------------------------------------------------
// CLOCK
// ---------------------------------------------------------------------------

// ⚠️ hourCycle:'h23', never hour12:false. hour12:false returns "24:00" for
// midnight in several engines, so 00:05 computes as 1445 minutes instead of 5.
// ⚠️ formatToParts, not a format string — assembling the parts ourselves
// cannot be bent by a locale quirk.
const IST = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const istParts = (d = new Date()) => {
  const p = {};
  for (const { type, value } of IST.formatToParts(d)) p[type] = value;
  return p;
};

/** Today in IST as YYYY-MM-DD. */
export const istDate = (d = new Date()) => {
  const p = istParts(d);
  return `${p.year}-${p.month}-${p.day}`;
};

/** A full instant. Unambiguous, so this one is safe to store. */
export const nowStamp = () => new Date().toISOString();

/** Whole days from an ISO date (YYYY-MM-DD) to IST today. Negative if future. */
export const daysSince = (iso, today = istDate()) => {
  const a = Date.parse(iso + 'T00:00:00Z');
  const b = Date.parse(today + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.round((b - a) / 86400000);
};

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

/** "14 September 2026" from an ISO date or a full instant. */
export const fmtDate = (iso) => {
  if (!iso) return '';
  const p = istParts(new Date(iso.length === 10 ? iso + 'T06:00:00Z' : iso));
  return `${+p.day} ${MONTHS[+p.month - 1]} ${p.year}`;
};

/** "14 Sep 2026, 14:32" — for an order's timeline. */
export const fmtStamp = (iso) => {
  if (!iso) return '';
  const p = istParts(new Date(iso));
  return `${+p.day} ${MONTHS[+p.month - 1].slice(0, 3)} ${p.year}, ${p.hour}:${p.minute}`;
};

// ---------------------------------------------------------------------------
// MONEY
//
// Integer rupees everywhere. Every price in this catalogue is a whole rupee,
// so there is no floating point in this app: no toFixed, no rounding rule to
// argue about, no drift down a thirty-line basket.
// ---------------------------------------------------------------------------

/** ₹1,49,999 — Indian lakh grouping. ₹149,999 on an Indian brand is an
 *  immediate tell that nobody thought about it. */
const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const rupees = (n) => '₹' + INR.format(Math.round(n || 0));

/** Derived, never stored: a stored percentage disagrees with the prices the
 *  moment anyone edits one. */
export const discountPct = (p) =>
  (p && p.mrp > p.price) ? Math.round((p.mrp - p.price) / p.mrp * 100) : 0;

/** The effective unit price for a chosen variant.
 *  ⚠️ Only the SIZE axis may carry a delta. Two priced axes make the effective
 *  price a 2-D matrix and the admin a spreadsheet. data.pl enforces it. */
export const variantPrice = (p, sel) => {
  if (!p) return 0;
  const sizes = p.variants && p.variants.size;
  if (!sizes || !sel || !sel.size) return p.price;
  const s = sizes.find((x) => x.id === sel.size);
  return p.price + (s ? (s.delta || 0) : 0);
};

export const variantMrp = (p, sel) => {
  if (!p) return 0;
  const sizes = p.variants && p.variants.size;
  if (!sizes || !sel || !sel.size) return p.mrp;
  const s = sizes.find((x) => x.id === sel.size);
  return p.mrp + (s ? (s.delta || 0) : 0);
};

/** ⚠️ Line identity is pid|colour|size, NOT pid. Two colours of one bed cover
 *  are two lines. Without this, adding Indigo then Madder silently increments
 *  the first and the customer receives two of the wrong thing. */
export const lineKey = (line) =>
  [line.pid, (line.variant && line.variant.colour) || '',
             (line.variant && line.variant.size) || ''].join('|');

export const variantLabel = (p, sel) => {
  if (!p || !sel) return '';
  const out = [];
  const c = p.variants && p.variants.colour;
  const s = p.variants && p.variants.size;
  if (c && sel.colour) { const f = c.find((x) => x.id === sel.colour); if (f) out.push(f.label); }
  if (s && sel.size && s.length > 1) { const f = s.find((x) => x.id === sel.size); if (f) out.push(f.label); }
  return out.join(' · ');
};

/** Matched case-insensitively with spaces stripped — nobody types a code
 *  carefully. Returns the coupon record or null. */
export const matchCoupon = (code, coupons) => {
  if (!code || !coupons || !coupons.codes) return null;
  const want = String(code).replace(/\s+/g, '').toUpperCase();
  return coupons.codes.find((c) => c.active && c.code.toUpperCase() === want) || null;
};

/**
 * THE HEART. Four rules that must not drift, each with the bug it prevents.
 *
 * 1. The free-shipping threshold is measured on ITEMS, BEFORE the coupon.
 *    A discount code must not win free shipping a basket had not earned.
 *    ⚠️ kirana's domain.js measures it on the post-coupon total while its
 *    money.pl measures it pre-coupon. They disagree, and it is dormant there
 *    only because both its numbers are zero. DEVI's are not.
 * 2. The discount is rounded ONCE, on the basket total — never per line.
 *    Per-line rounding lets the sum of the parts disagree with the total.
 * 3. maxOff caps the discount AFTER rounding.
 * 4. A coupon's minItems is measured on items BEFORE discount, so a code
 *    cannot unlock itself.
 *
 * Vouchers are excluded from shipping entirely — there is nothing to ship.
 * bulkySurcharge applies once per BULKY LINE, not per unit.
 */
export function totals(lines, byId, rules, coupon) {
  let items = 0, mrpTotal = 0, bulky = 0, physical = 0;

  for (const ln of lines) {
    const p = byId(ln.pid);
    if (!p) continue;
    const unit = variantPrice(p, ln.variant);
    const umrp = variantMrp(p, ln.variant);
    items += unit * ln.qty;
    mrpTotal += umrp * ln.qty;
    if (p.kind !== 'voucher') {
      physical += ln.qty;
      if (p.shipClass === 'bulky') bulky += rules.bulkySurcharge || 0;
    }
  }

  // Rule 4, then rules 2 and 3.
  let discount = 0, couponOk = false;
  if (coupon && items >= (coupon.minItems || 0)) {
    couponOk = true;
    discount = coupon.percent
      ? Math.round(items * coupon.percent / 100)
      : (coupon.flat || 0);
    if (coupon.maxOff) discount = Math.min(discount, coupon.maxOff);
    discount = Math.min(discount, items);
  }

  // Rule 1 — `items`, not `items - discount`.
  const freeShip = physical === 0 || items >= rules.freeOver;
  const shipping = freeShip ? 0 : (rules.fee || 0);

  return {
    items, mrpTotal,
    saved: Math.max(0, mrpTotal - items),
    couponOk, discount,
    shipping, bulky,
    toFree: Math.max(0, rules.freeOver - items),
    physical,
    grand: items - discount + shipping + bulky,
  };
}

// ---------------------------------------------------------------------------
// CATALOGUE
// ---------------------------------------------------------------------------

/** ⚠️ Derived, never stored. A stored "new" badge makes a product new for three
 *  years; a stored "sale" badge survives the sale ending. `badges` in the JSON
 *  holds only what a human chose, and data.pl fails if a derived name appears
 *  in it. */
export function derivedBadges(p, shop, today = istDate()) {
  const out = [];
  if (p.kind !== 'voucher') {
    if (p.stock === 0) out.push('sold-out');
    else if (p.stock <= (shop.lowStockAt || 0)) out.push('low-stock');
  }
  if (daysSince(p.addedOn, today) <= (shop.newDays || 0)) out.push('new');
  if (p.mrp > p.price) out.push('sale');
  return out;
}

export const isNew = (p, shop, today = istDate()) =>
  daysSince(p.addedOn, today) <= (shop.newDays || 0);

export const SORTS = [
  { id: 'popularity', label: 'Popularity' },
  { id: 'new', label: 'New Arrivals' },
  { id: 'price-asc', label: 'Price: Low to High' },
  { id: 'price-desc', label: 'Price: High to Low' },
  { id: 'discount', label: 'Biggest Saving' },
];

export function sortProducts(list, sort) {
  const a = list.slice();
  switch (sort) {
    case 'price-asc':  return a.sort((x, y) => x.price - y.price || x.name.localeCompare(y.name));
    case 'price-desc': return a.sort((x, y) => y.price - x.price || x.name.localeCompare(y.name));
    case 'new':        return a.sort((x, y) => (y.addedOn || '').localeCompare(x.addedOn || ''));
    case 'discount':   return a.sort((x, y) => discountPct(y) - discountPct(x));
    default:           return a.sort((x, y) => (y.popularity || 0) - (x.popularity || 0));
  }
}

export function filterProducts(list, f) {
  return list.filter((p) => {
    if (f.cat && p.cat !== f.cat) return false;
    if (f.sub && p.sub !== f.sub) return false;
    if (f.min != null && p.price < f.min) return false;
    if (f.max != null && p.price > f.max) return false;
    return true;
  });
}

/** Name, tags, category and subcategory. Every term must match something —
 *  "indigo kurti" should not return every indigo thing in the shop. */
export function searchProducts(list, q, cats) {
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const names = {};
  if (cats) for (const c of cats) {
    names[c.id] = c.name.toLowerCase();
    for (const s of c.sub) names[s.id] = s.name.toLowerCase();
  }
  return list.filter((p) => {
    const hay = [p.name, p.shortDesc, (p.tags || []).join(' '),
                 names[p.cat] || '', names[p.sub] || ''].join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** Same subcategory first, then the same category, never the product itself.
 *
 *  ⚠️ The cat test on `same` is load-bearing, not belt-and-braces. A product
 *  in a category with no subcategories has NO `sub` key, so a bare
 *  `x.sub === p.sub` matches undefined to undefined and pulls every bedcover
 *  into a table runner's related list. */
export function relatedTo(p, list, n = 4) {
  const same = list.filter((x) => x.id !== p.id && x.cat === p.cat
                                  && x.sub === p.sub);
  const near = list.filter((x) => x.id !== p.id && x.cat === p.cat && x.sub !== p.sub);
  return same.concat(near).slice(0, n);
}

export function priceBands(list) {
  if (!list.length) return [];
  const max = Math.max(...list.map((p) => p.price));
  const bands = [
    { id: 'u999', label: 'Under ₹999', min: 0, max: 999 },
    { id: '1-2k', label: '₹1,000 – ₹1,999', min: 1000, max: 1999 },
    { id: '2-4k', label: '₹2,000 – ₹3,999', min: 2000, max: 3999 },
    { id: '4k+', label: '₹4,000 and above', min: 4000, max: null },
  ];
  return bands.filter((b) => b.min <= max);
}

// ---------------------------------------------------------------------------
// ROUTING — pure, so routes.pl can check the table without a DOM.
//
// Hash routing, because tools/serve.pl 404s anything that is not a file on
// disk (serve.pl:78). A path route would break on refresh and on any pasted
// deep link — exactly what shareable product URLs are meant to fix.
// ---------------------------------------------------------------------------

export const ROUTES = [
  { re: /^\/?$/,                     screen: 'home',     keys: [] },
  { re: /^\/shop$/,                  screen: 'listing',  keys: [] },
  { re: /^\/c\/([a-z0-9-]+)$/,       screen: 'listing',  keys: ['cat'] },
  { re: /^\/c\/([a-z0-9-]+)\/([a-z0-9-]+)$/, screen: 'listing', keys: ['cat', 'sub'] },
  { re: /^\/new$/,                   screen: 'listing',  keys: [] },
  { re: /^\/best$/,                  screen: 'listing',  keys: [] },
  { re: /^\/search$/,                screen: 'listing',  keys: [] },
  { re: /^\/p\/([a-z0-9-]+)$/,       screen: 'product',  keys: ['slug'] },
  { re: /^\/cart$/,                  screen: 'cart',     keys: [] },
  { re: /^\/checkout$/,              screen: 'checkout', keys: [] },
  { re: /^\/order\/([A-Za-z0-9-]+)$/, screen: 'confirm', keys: ['code'] },
  { re: /^\/wishlist$/,              screen: 'wishlist', keys: [] },
  { re: /^\/account$/,               screen: 'account',  keys: [] },
  { re: /^\/about$/,                 screen: 'info',     keys: [], page: 'about' },
  { re: /^\/contact$/,               screen: 'info',     keys: [], page: 'contact' },
  { re: /^\/shipping$/,              screen: 'info',     keys: [], page: 'shipping' },
  { re: /^\/returns$/,               screen: 'info',     keys: [], page: 'returns' },
  { re: /^\/privacy$/,               screen: 'info',     keys: [], page: 'privacy' },
  { re: /^\/terms$/,                 screen: 'info',     keys: [], page: 'terms' },
  { re: /^\/admin$/,                 screen: 'admin',    keys: [] },
  { re: /^\/admin\/([a-z-]+)$/,      screen: 'admin',    keys: ['tab'] },
];

/** "#/shop?sort=price-asc&min=500" -> { screen, params, query, path }.
 *  Query lives AFTER the hash so a filtered view is shareable and the browser
 *  back button undoes a filter, which is what people expect. */
export function parseRoute(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const qi = raw.indexOf('?');
  const path = (qi === -1 ? raw : raw.slice(0, qi)) || '/';
  const query = {};
  if (qi !== -1) {
    for (const [k, v] of new URLSearchParams(raw.slice(qi + 1))) query[k] = v;
  }
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    if (r.page) params.page = r.page;
    return { screen: r.screen, params, query, path };
  }
  return { screen: 'notfound', params: {}, query, path };
}

export function buildHash(path, query) {
  const q = new URLSearchParams();
  for (const k of Object.keys(query || {})) {
    const v = query[k];
    if (v !== '' && v != null) q.set(k, v);
  }
  const s = q.toString();
  return '#' + path + (s ? '?' + s : '');
}

// ---------------------------------------------------------------------------
// ORDER STATUS
//
// ⚠️ An order starts at `draft`, NOT `placed`. An order the merchant has never
// seen is not placed. draft -> sent happens when the CUSTOMER hands it over;
// sent -> confirmed is an ADMIN action, a human at DEVI saying "I have this".
// Nothing advances on a timer, and there is no "processing" state because
// nothing processes.
//
// Invalid transitions throw. A silent no-op is a button that looks like it
// worked.
// ---------------------------------------------------------------------------

export const ORDER_NEXT = {
  draft:     ['sent', 'abandoned'],
  sent:      ['confirmed', 'abandoned'],
  confirmed: ['packed', 'cancelled'],
  packed:    ['shipped', 'cancelled'],
  shipped:   ['delivered', 'returned'],
  delivered: ['returned'],
  returned:  [],
  cancelled: [],
  abandoned: [],
};

export const canAdvance = (from, to) => (ORDER_NEXT[from] || []).includes(to);

export const STATUS_LABEL = {
  draft: 'Not sent yet',
  sent: 'Sent to DEVI',
  confirmed: 'Confirmed by DEVI',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  returned: 'Returned',
  cancelled: 'Cancelled',
  abandoned: 'Abandoned',
};

export const STATUS_TONE = {
  draft: 'draft', sent: 'sent', confirmed: 'good', packed: 'good',
  shipped: 'good', delivered: 'good',
  returned: 'bad', cancelled: 'bad', abandoned: 'bad',
};

// ---------------------------------------------------------------------------
// THE HANDOFF
//
// One function builds the order text, so what goes to WhatsApp, what the
// clipboard holds and what the admin screen shows can never disagree.
// ---------------------------------------------------------------------------

export function orderSummaryText(o, shop) {
  const L = [];
  L.push(`${shop.brand.name} — order ${o.code}`);
  L.push('');
  for (const ln of o.lines) {
    L.push(`${ln.qty} x ${ln.name}${ln.variantLabel ? ' (' + ln.variantLabel + ')' : ''}`
         + ` — ${rupees(ln.lineTotal)}`);
  }
  L.push('');
  L.push(`Items: ${rupees(o.itemsTotal)}`);
  if (o.discount) L.push(`Coupon ${o.coupon}: −${rupees(o.discount)}`);
  if (o.shipping) L.push(`Shipping: ${rupees(o.shipping)}`);
  if (o.bulky) L.push(`Bulky item handling: ${rupees(o.bulky)}`);
  L.push(`Total: ${rupees(o.grand)}`);
  L.push('');
  L.push(`Payment: ${o.payMethod === 'cod' ? 'Cash on delivery' : 'UPI'}`);
  L.push('');
  L.push(`${o.customer.name}`);
  L.push(`${o.customer.mobile}`);
  if (o.customer.email) L.push(`${o.customer.email}`);
  L.push(`${o.customer.addr}`);
  L.push(`${o.customer.city}, ${o.customer.state} ${o.customer.pin}`);
  return L.join('\n');
}

const digits = (s) => String(s || '').replace(/\D/g, '');

export const whatsappLink = (text, shop) => {
  const n = digits(shop.contact.whatsapp || shop.contact.phone);
  if (!n) return null;
  return `https://wa.me/${n.length === 10 ? '91' + n : n}?text=${encodeURIComponent(text)}`;
};

export const telLink = (shop) => {
  const n = digits(shop.contact.phone);
  return n ? `tel:+${n.length === 10 ? '91' + n : n}` : null;
};

export const mailtoLink = (subject, body, shop) => {
  if (!shop.contact.email) return null;
  return `mailto:${shop.contact.email}?subject=${encodeURIComponent(subject)}`
       + `&body=${encodeURIComponent(body)}`;
};

/** The UPI deep-link payload the QR carries. Amount and order code included,
 *  so the shop can reconcile without asking. */
export const upiPayload = (upi, amount, code) =>
  `upi://pay?pa=${encodeURIComponent(upi.vpa)}`
  + `&pn=${encodeURIComponent(upi.payeeName)}`
  + `&am=${amount}&cu=INR&tn=${encodeURIComponent(code)}`;

// ---------------------------------------------------------------------------
// GATEWAY STATE — three states, driven entirely by shop.json.
//
// ⚠️ `live` NEVER means a payment can be trusted. Razorpay's success handler
// returns razorpay_payment_id IN THE BROWSER, which is forgeable. Verifying it
// needs an HMAC over the key secret, which cannot exist in a static page.
// ---------------------------------------------------------------------------
export function gatewayState(gw) {
  if (!gw || !gw.keyId) {
    return { on: false, test: false,
             why: 'Card and net banking need a payment gateway. Not set up yet.' };
  }
  if (!gw.live) {
    return { on: true, test: true,
             why: 'Razorpay is in test mode. No real money moves.' };
  }
  return { on: true, test: false,
           why: 'Payment is confirmed by our team, not by this page.' };
}

// ---------------------------------------------------------------------------
// MISC
// ---------------------------------------------------------------------------

/** A 6-digit Indian PIN that does not start with 0. */
export const validPin = (s) => /^[1-9][0-9]{5}$/.test(String(s || '').trim());

/** A 10-digit Indian mobile, optionally with +91. Starts 6-9. */
export const validMobile = (s) => {
  const d = digits(s);
  return (d.length === 10 && /^[6-9]/.test(d))
      || (d.length === 12 && d.startsWith('91') && /^[6-9]/.test(d.slice(2)));
};

/** ['a'] -> 'a' · ['a','b'] -> 'a and b' · ['a','b','c'] -> 'a, b and c' */
export function listOf(xs) {
  const a = (xs || []).filter(Boolean);
  if (a.length < 3) return a.join(' and ');
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

export const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());

export const STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir',
  'Ladakh','Lakshadweep','Puducherry',
];
