// ============================================================================
// Your profile -- reached from the person icon in the header on every screen
// (8 November 2026, the owner's ask: "a profile option on all screens … just
// like Milan"). Who you are, your orders, your addresses, your name and
// mobile, how to reach the shop, and the settings. Milan's settings screen
// was the model -- the shop's phone, the account, the address book, a reset
// -- in this shop's own words and shapes; nothing is shared with it.
//
// Three cases, and the page says which one it is in:
//
//   ONE BROWSER  No database (config.js empty, or the single-file build): the
//                details that prefill checkout, the orders made in this
//                browser, and Clear everything. It is NOT an account and its
//                first notice says so; honesty.pl keeps that sentence here.
//   A GUEST      A database, nobody signed in: the sign-in box first. With
//                SIGN_IN_TO_ORDER on, checkout asks for the same thing.
//   SIGNED IN    Who, a Sign out, every order on the account from any phone,
//                the address book checkout offers, and the account's own
//                name and mobile.
//
// ⚠️ THERE IS STILL NO PASSWORD, AND NO SIGN-IN SCREEN OF ITS OWN. The box
// lives inside this page and two others; honesty.pl fails on a password field
// in the shop and on a login/sign-in route or screen.
//
// ⚠️ REGIONS, NOT ONE PAINT. 'orders' redraws the orders panel only,
// 'addresses' the address book only and 'details' the name at the top only,
// so none can wipe a code half typed into the sign-in box or an address half
// typed into its form. 'session' -- signing in or out -- is the one change
// that redraws the whole page.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, h1, notice, toast, askFirst } from '../ui.js';
import { field, setFieldError, orderChain } from '../components.js';
import { signInBox, wireSignIn } from '../signin.js';
import { OTP_LEN } from '../config.js';
import { icon } from '../icons.js';
import { art } from '../art.js';
import * as D from '../domain.js';

const DETAILS = ['name', 'mobile', 'email', 'addr', 'city', 'state', 'pin'];
const ADDR = ['name', 'mobile', 'addr', 'city', 'state', 'pin'];

let who = null;      // as of the last full paint
let gen = 0;         // which full paint is current

router.registerScreen('account', async (host) => {
  await paint(host);
  router.onLeave(store.live.subscribe('orders', () => paintOrders(host)));
  router.onLeave(store.live.subscribe('addresses', () => paintBook(host)));
  router.onLeave(store.live.subscribe('details', () => paintName(host)));
  router.onLeave(store.live.subscribe('session', () => paint(host)));
});

const inside = () => !!(who && !who.guest);

/** "Arrives 10–16 November" while it is on its way, "Delivered 12 November"
 *  once it is not. Read off the order; nothing here works out a date. */
function whenLine(o) {
  if (o.status === 'delivered' && o.deliveredAt) return `Delivered ${D.fmtDate(o.deliveredAt)}`;
  if (o.arrives && ['sent', 'confirmed', 'packed', 'shipped'].includes(o.status)) {
    return `Arrives ${D.fmtDateRange(o.arrives.from, o.arrives.to)}`;
  }
  return '';
}

/** The customer's word for where an order is, on its pill. */
function pillWord(o) {
  if (o.status === 'sent') return o.sentVia === 'online' ? 'Ordered' : 'Sent';
  if (o.status === 'abandoned' && o.sentVia === 'online') return 'Cancelled';
  return D.STATUS_LABEL[o.status];
}

// ---------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------
async function paint(host) {
  const mine = (gen += 1);
  const w = store.account ? await store.account.whoami() : null;
  const [orders, wishIds, shop, all, bag] = await Promise.all([
    store.orders.mine(), store.wishlist.ids(), store.catalog.shop(), store.catalog.all(),
    store.cart.lines(),
  ]);
  if (mine !== gen) return;
  who = w;
  const c = shop.contact || {};

  host.innerHTML = `
  ${h1(store.account ? 'Your profile' : 'Your details', 'Profile')}

  ${topNotice()}

  <div class="acct-grid">
    <div class="acct-col">
      <section class="panel acct-me" data-who>${whoPanel()}</section>
      <section class="panel" data-orders>${ordersPanel(orders, all)}</section>
      <section class="panel" data-book></section>
    </div>

    <aside class="acct-col">
      ${inside() ? '<section class="panel" data-details></section>' : ''}

      <section class="panel">
        <h2 class="t-h3">Help and support</h2>
        <p class="t-micro dim acct-sub">We answer ${esc(c.hours || 'during working hours')}.</p>
        <div class="acct-list">
          ${c.phone ? row(D.telLink(shop), 'phone', 'Call us', c.phone) : ''}
          ${c.whatsapp ? row(D.whatsappLink('Hello ' + shop.brand.name + ',\n\n', shop),
            'chat', 'WhatsApp us', c.whatsapp, true) : ''}
          ${c.email ? row(D.mailtoLink('A question', '', shop), 'mail', 'Email us', c.email) : ''}
          ${row('#/contact', 'info', 'Contact page', 'Write to us from the site')}
          ${row('#/shipping', 'truck', 'Shipping and delivery', '')}
          ${row('#/returns', 'refresh', 'Returns and refunds', '')}
        </div>
      </section>

      <section class="panel">
        <h2 class="t-h3">Settings</h2>
        <div class="acct-list">
          ${row('#/wishlist', 'heart', 'Wishlist', wishIds.length
            ? `${wishIds.length} saved` : 'Nothing saved yet')}
          ${row('#/cart', 'bag', 'Bag', bag.length
            ? `${bag.reduce((n, l) => n + l.qty, 0)} in your bag` : 'Empty')}
          ${row('#/privacy', 'shield', 'Privacy policy', '')}
          ${row('#/terms', 'copy', 'Terms and conditions', '')}
        </div>
        <div class="acct-actions">
          ${inside() ? `<button type="button" class="btn btn-secondary btn-block" data-signout>
            ${icon('user', 16)} Sign out of this phone</button>` : ''}
          <button type="button" class="btn btn-secondary btn-block" data-clear>
            ${icon('trash', 16)} Clear this browser</button>
          <p class="t-micro dim">
            ${store.shared()
              ? 'Clearing takes your details, bag and wishlist off this browser. Your orders '
                + 'stay: once placed, they are with us.'
              : 'Clearing takes your details, bag, wishlist and every order off this browser. '
                + 'There is no copy anywhere else.'}</p>
        </div>
      </section>
    </aside>
  </div>`;

  if (store.account && !inside()) {
    wireSignIn(host.querySelector('[data-who]'), (w2) => {
      toast(w2.moved
        ? `Signed in. ${w2.moved} ${w2.moved === 1 ? 'order' : 'orders'} from this phone `
          + 'moved into your account.'
        : `Signed in as ${w2.email}`);
      // 'session' has fired: the page is being redrawn signed in.
    });
  }
  const out = host.querySelector('[data-signout]');
  if (out) {
    out.addEventListener('click', async () => {
      const ok = await askFirst({
        title: 'Sign out of this phone?',
        body: '<p>Your orders and addresses stay on your account. Sign in again with the same '
          + 'email, here or on any phone, to see them.</p>',
        yes: 'Sign out',
      });
      if (!ok) return;
      out.disabled = true;
      try {
        await store.account.signOut();
        toast('Signed out. Your details have been taken off this phone.');
      } catch (e) {
        out.disabled = false;
        toast('Could not sign out just now: ' + String(e.message || e));
      }
    });
  }
  wireClear(host);
  await paintBook(host);
  paintDetails(host);
}

/** A row of the help and settings lists: an icon, what it is, and a line. */
function row(href, ico, label, sub, external = false) {
  const inner = `${icon(ico, 18)}
    <span class="acct-row-mid"><span class="acct-row-l">${esc(label)}</span>
      ${sub ? `<span class="acct-row-s user-text">${esc(sub)}</span>` : ''}</span>
    ${icon('chevron', 14)}`;
  return href
    ? `<a class="acct-row" href="${esc(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`
    : `<div class="acct-row">${inner}</div>`;
}

function topNotice() {
  if (!store.shared()) {
    return notice('info', '<b>This is not an account.</b> There is no login here, '
      + 'because there is no server to hold one. Your details, your wishlist and '
      + 'your orders are saved in this browser only — clearing your browser data '
      + 'erases all of it, and opening this site on another device shows an empty one.');
  }
  if (!store.account) {
    return notice('info', '<b>Not an account yet.</b> Your orders reach us the moment '
      + 'you place them, but only this browser can show them to you: with no sign-in '
      + 'yet, another phone cannot tell they are yours. Your details and your wishlist '
      + 'are kept in this browser only.');
  }
  return '';
}

/** The top of the page: who this is. Signed in, a name -- the account's own,
 *  else the default address's -- and the email; a guest, the sign-in box. */
function whoPanel() {
  if (inside()) {
    const name = who.name || '';
    const letter = (name || who.email || '?').trim().charAt(0).toUpperCase();
    return `
      <div class="acct-id">
        <span class="acct-avatar" aria-hidden="true">${esc(letter)}</span>
        <div class="acct-id-mid">
          <div class="acct-name user-text" data-name>${esc(name || who.email)}</div>
          <div class="acct-email user-text" data-email ${name ? '' : 'hidden'}>${esc(who.email)}</div>
          <div class="acct-on">${icon('check', 13)} Signed in · your orders and addresses
            open on any phone where you sign in</div>
        </div>
      </div>`;
  }
  if (store.account) {
    return `
      <div class="acct-id">
        <span class="acct-avatar is-guest" aria-hidden="true">${icon('user', 22)}</span>
        <div class="acct-id-mid">
          <div class="acct-name">Sign in</div>
          <div class="acct-on is-off">To place an order, and to see it on any phone</div>
        </div>
      </div>
      <div style="margin-top:var(--s4)">
        ${signInBox(`Your email, then the ${OTP_LEN}-digit code we send you — there is no
          password. Your orders, addresses and details then open on any phone.`)}
      </div>`;
  }
  return `
    <div class="acct-id">
      <span class="acct-avatar is-guest" aria-hidden="true">${icon('user', 22)}</span>
      <div class="acct-id-mid">
        <div class="acct-name">This browser</div>
        <div class="acct-on is-off">Your details and orders are kept here only</div>
      </div>
    </div>`;
}

/** Only the name at the top, after the details change: the rest of the page
 *  may hold a half-typed address. */
async function paintName(host) {
  if (!inside() || !store.account) return;
  who = await store.account.whoami();
  const el = host.querySelector('[data-name]');
  if (el) el.textContent = who.name || who.email;
  const em = host.querySelector('[data-email]');
  if (em) em.hidden = !who.name;
  const av = host.querySelector('.acct-avatar');
  if (av) av.textContent = (who.name || who.email || '?').trim().charAt(0).toUpperCase();
}

// ---------------------------------------------------------------------------
// ORDERS -- each one a card that opens the order: its chain, what is in it,
// what it costs and when it comes.
// ---------------------------------------------------------------------------
function ordersPanel(orders, all) {
  const head = inside() ? 'Your orders'
    : store.shared() ? 'Orders placed on this phone' : 'Orders from this browser';
  const byId = (id) => (all || []).find((p) => p.id === id);
  return `
    <h2 class="t-h3">${head}</h2>
    ${orders.length ? `<div class="ocards">${orders.map((o) => {
      // What is still coming: an item the shop cancelled is neither counted
      // nor pictured -- unless every one was, and then the card shows them.
      const live = o.lines.filter((l) => l.status !== 'cancelled');
      const shown = live.length ? live : o.lines;
      const n = live.reduce((k, l) => k + l.qty, 0);
      const pics = shown.slice(0, 3).map((l) => {
        const p = byId(l.pid);
        const col = p && p.variants && (p.variants.colour || [])
          .find((x) => x.id === (l.variant || {}).colour);
        return p ? `<span class="ocard-pic">${art(p, col && col.img != null ? col.img : 0)}</span>`
          : '<span class="ocard-pic"></span>';
      }).join('');
      const when = whenLine(o);
      return `<a class="ocard" href="#/order/${esc(o.code)}"
          aria-label="Order ${esc(o.code)}, ${esc(pillWord(o))}. See its details">
        <span class="ocard-pics">${pics}</span>
        <span class="ocard-mid">
          <span class="ocard-top"><b class="ocard-code">${esc(o.code)}</b>
            <span class="pill pill-${D.STATUS_TONE[o.status]}">${esc(pillWord(o))}</span></span>
          <span class="ocard-meta">${D.fmtDate(o.createdAt)} · ${n} ${n === 1 ? 'item' : 'items'} ·
            ${D.rupees(o.grand)}</span>
          ${when ? `<span class="ocard-meta ocard-when">${esc(when)}</span>` : ''}
          ${orderChain(o, true)}
        </span>
        <span class="ocard-go" aria-hidden="true">${icon('chevron', 16)}</span>
      </a>`;
    }).join('')}</div>`
    : `<p class="t-micro dim" style="margin-top:var(--s3)">
        ${store.shared()
          ? 'No orders yet. Each one you place opens here, with where it has got to.'
          : 'No orders yet. When you place one you will be able to reopen it here '
            + '— including the QR and the send buttons.'}</p>`}
    ${orders.some((o) => o.status === 'draft') ? `
      <div style="margin-top:var(--s4)">
        ${notice('warn', 'One or more of these has not been sent to us yet. '
          + 'Open it and use the send buttons, or it stays here and nowhere else.')}
      </div>` : ''}`;
}

async function paintOrders(host) {
  const [orders, all] = await Promise.all([store.orders.mine(), store.catalog.all()]);
  const box = host.querySelector('[data-orders]');
  if (box) box.innerHTML = ordersPanel(orders, all);
}

// ---------------------------------------------------------------------------
// YOUR DETAILS (signed in) -- the account's own name and mobile, kept on the
// account (store.account.saveDetails), so they fill a new address in on any
// phone. Checkout saves them the first time an order is placed.
// ---------------------------------------------------------------------------
function paintDetails(host) {
  const box = host.querySelector('[data-details]');
  if (!box || !inside()) return;
  box.innerHTML = `
    <h2 class="t-h3">Your details</h2>
    <p class="t-micro dim acct-sub">They fill in a new address for you, on any phone.</p>
    <div class="form-grid">
      ${field('me-name', 'Full name', { value: who.name || '', span: true })}
      ${field('me-mobile', 'Mobile number', { value: who.mobile || '', type: 'tel',
        inputmode: 'numeric', placeholder: '10 digits', maxlength: 13, span: true })}
      <div class="field" style="grid-column:1/-1"><label>Email</label>
        <p class="acct-fixed user-text">${esc(who.email)}
          <span class="t-micro dim">— the one you sign in with</span></p></div>
    </div>
    <div style="margin-top:var(--s4)">
      <button type="button" class="btn btn-primary" data-me-save>Save details</button>
    </div>`;
  const save = box.querySelector('[data-me-save]');
  save.addEventListener('click', async () => {
    const name = box.querySelector('[name="me-name"]').value.trim();
    const mobile = box.querySelector('[name="me-mobile"]').value.trim();
    const errs = {};
    if (name && name.length < 2) errs['me-name'] = 'A name, so the parcel finds you.';
    if (mobile && !D.validMobile(mobile)) errs['me-mobile'] = 'A 10-digit Indian mobile, starting 6 to 9.';
    for (const n of ['me-name', 'me-mobile']) setFieldError(box, n, errs[n] || null);
    if (Object.keys(errs).length) { toast('Please check the highlighted fields'); return; }
    save.disabled = true;
    try {
      await store.account.saveDetails({ name, mobile });
      toast('Details saved to your account');
    } catch (e) {
      toast('Those did not save: ' + String(e.message || e));
    }
    save.disabled = false;
  });
}

// ---------------------------------------------------------------------------
// THE ADDRESS BOOK when signed in; this browser's details otherwise.
// ---------------------------------------------------------------------------
async function paintBook(host) {
  const box = host.querySelector('[data-book]');
  if (!box) return;
  if (!inside()) {
    // A guest on a database signs in first; their details travel with the
    // account from then on. In one browser, the details form as before.
    if (store.account) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = detailsPanel(await store.profile.get());
    wireDetails(box);
    return;
  }
  box.hidden = false;
  let list;
  try {
    list = await store.addresses.list();
  } catch (e) {
    box.innerHTML = '<h2 class="t-h3">Saved addresses</h2>'
      + notice('bad', 'Your addresses could not be loaded just now. Please try again.');
    return;
  }
  box.innerHTML = bookPanel(list);
  wireBook(box, list);
}

function detailsPanel(profile) {
  return `
    <h2 class="t-h3">Details</h2>
    <p class="t-micro dim" style="margin:var(--s2) 0 var(--s4)">
      Saved here so checkout fills itself in. Nothing is sent anywhere.</p>
    <div class="form-grid">
      ${field('name', 'Full name', { value: profile.name, span: true })}
      ${field('mobile', 'Mobile number', { value: profile.mobile, type: 'tel',
        inputmode: 'numeric', maxlength: 13 })}
      ${field('email', 'Email', { value: profile.email, type: 'email' })}
      ${field('addr', 'Address', { value: profile.addr, rows: 3, span: true })}
      ${field('city', 'City', { value: profile.city })}
      ${field('pin', 'PIN code', { value: profile.pin, inputmode: 'numeric', maxlength: 6 })}
      ${field('state', 'State', { value: profile.state, options: D.STATES, span: true })}
    </div>
    <div style="margin-top:var(--s4)">
      <button type="button" class="btn btn-primary" data-save>Save details</button>
    </div>`;
}

function wireDetails(box) {
  box.querySelector('[data-save]').addEventListener('click', async () => {
    const v = {};
    for (const n of DETAILS) {
      const el = box.querySelector(`[name="${n}"]`);
      v[n] = el ? el.value.trim() : '';
    }
    // Lighter than checkout: this is a convenience, and a half-filled profile
    // is a perfectly reasonable thing to save.
    const errs = {};
    if (v.mobile && !D.validMobile(v.mobile)) errs.mobile = 'A 10-digit Indian mobile.';
    if (v.email && !D.validEmail(v.email)) errs.email = 'That does not look like an email.';
    if (v.pin && !D.validPin(v.pin)) errs.pin = 'Six digits, not starting with zero.';
    for (const n of ['mobile', 'email', 'pin']) setFieldError(box, n, errs[n] || null);
    if (Object.keys(errs).length) { toast('Please check the highlighted fields'); return; }

    await store.profile.save(v);
    toast('Saved in this browser');
  });
}

const MAX_ADDR = 10;   // the same ceiling as save_address() in db/schema.sql

function bookPanel(list) {
  return `
    <div class="book-head">
      <h2 class="t-h3">Saved addresses</h2>
      ${list.length && list.length < MAX_ADDR ? `<button type="button" class="btn btn-secondary btn-sm"
        data-addr-new>${icon('plus', 14)} Add an address</button>` : ''}
    </div>
    ${list.length ? '' : `<p class="t-micro dim acct-sub">Add the address your parcels go to.
      Checkout then only asks you to pick it.</p>`}
    <div data-addr-form hidden></div>
    ${list.length ? `<div class="book">${list.map(addrCard).join('')}</div>` : ''}
    ${list.length >= MAX_ADDR ? `<p class="t-micro dim" style="margin-top:var(--s3)">
      Ten is as many as an account keeps. Remove one to add another.</p>` : ''}`;
}

const addrCard = (a) => `
  <div class="addr-card" data-addr="${esc(a.id)}">
    <div>
      <div class="addr-name">${esc(a.name)}${a.isDefault
        ? ' <span class="pill pill-good">Default</span>' : ''}</div>
      <div class="addr-lines">${esc(a.addr)}<br>${esc(a.city)}, ${esc(a.state)}
        ${esc(a.pin)}<br>${esc(a.mobile)}</div>
    </div>
    <div class="addr-acts">
      <button type="button" class="btn-ghost" data-addr-edit>Edit</button>
      ${a.isDefault ? '' : '<button type="button" class="btn-ghost" data-addr-default>Make default</button>'}
      <button type="button" class="btn-ghost" data-addr-del>Remove</button>
    </div>
  </div>`;

function addrForm(a, first) {
  return `
    <div class="addr-form">
      <h3 class="t-h3">${a.id ? 'Change this address' : first ? 'Your delivery address' : 'A new address'}</h3>
      <div class="form-grid">
        ${field('ab-name', 'Full name', { required: true, value: a.name || '', span: true })}
        ${field('ab-mobile', 'Mobile number', { required: true, value: a.mobile || '',
          type: 'tel', inputmode: 'numeric', placeholder: '10 digits', maxlength: 13 })}
        ${field('ab-addr', 'Address', { required: true, value: a.addr || '', rows: 3,
          span: true, placeholder: 'Flat, building, street, area' })}
        ${field('ab-city', 'City', { required: true, value: a.city || '' })}
        ${field('ab-pin', 'PIN code', { required: true, value: a.pin || '',
          inputmode: 'numeric', maxlength: 6 })}
        ${field('ab-state', 'State', { required: true, value: a.state || '',
          options: D.STATES, span: true })}
      </div>
      ${first ? '' : `<label class="tick"><input type="checkbox" data-ab-default
        ${a.isDefault ? 'checked disabled' : ''}> Offer this one first at checkout</label>`}
      <div class="addr-form-acts">
        <button type="button" class="btn btn-primary" data-ab-save>Save address</button>
        ${first ? '' : '<button type="button" class="btn btn-secondary" data-ab-cancel>Cancel</button>'}
      </div>
    </div>`;
}

/** The same rules checkout uses, so a saved address is one it will take. */
function checkAddr(v) {
  const errs = {};
  if (v.name.length < 2) errs.name = 'We need a name for the parcel.';
  if (!D.validMobile(v.mobile)) errs.mobile = 'A 10-digit Indian mobile, starting 6 to 9.';
  if (v.addr.length < 10) errs.addr = 'Flat or house number, building, street and area.';
  if (!v.city) errs.city = 'Which city?';
  if (!v.state) errs.state = 'Choose a state.';
  if (!D.validPin(v.pin)) errs.pin = 'Six digits, not starting with zero.';
  return errs;
}

function addrWhyNot(e) {
  const m = String((e && e.message) || e);
  if (/NOT_SIGNED_IN/.test(m)) return 'You are not signed in any more. Sign in again, then save it.';
  if (/TOO_MANY_ADDRESSES/.test(m)) return 'Ten is as many as an account keeps. Remove one first.';
  if (/NO_SUCH_ADDRESS/.test(m)) return 'That address is not there any more.';
  if (/fetch|network|load failed/i.test(m)) return 'We could not reach the shop just now. Please try again.';
  return 'That did not save: ' + m;
}

function wireBook(box, list) {
  const formBox = box.querySelector('[data-addr-form]');

  const open = (a, first = false) => {
    formBox.innerHTML = addrForm(a, first);
    formBox.hidden = false;
    if (!first) formBox.querySelector('[name="ab-name"]').focus();
    const cancel = formBox.querySelector('[data-ab-cancel]');
    if (cancel) {
      cancel.addEventListener('click', () => {
        formBox.hidden = true;
        formBox.innerHTML = '';
      });
    }
    const save = formBox.querySelector('[data-ab-save]');
    save.addEventListener('click', async () => {
      const v = {};
      for (const n of ADDR) {
        const el = formBox.querySelector(`[name="ab-${n}"]`);
        v[n] = el ? el.value.trim() : '';
      }
      const errs = checkAddr(v);
      for (const n of ADDR) setFieldError(formBox, 'ab-' + n, errs[n] || null);
      if (Object.keys(errs).length) {
        const bad = formBox.querySelector('.field.bad input, .field.bad select, .field.bad textarea');
        if (bad) bad.focus();
        toast('Please check the highlighted fields');
        return;
      }
      save.disabled = true;
      const def = formBox.querySelector('[data-ab-default]');
      try {
        await store.addresses.save({ ...v, id: a.id, isDefault: first || !!(def && def.checked) });
        toast(a.id ? 'Address changed' : 'Address saved. Checkout will offer it.');
        // 'addresses' has fired: the book is being redrawn with it.
      } catch (e) {
        save.disabled = false;
        toast(addrWhyNot(e));
      }
    });
  };

  // Signed in with no address yet: the form is already open (the owner, 8
  // November 2026: "in sign in we should add the address too"), started from
  // the account's own name and mobile.
  if (!list.length) open({ name: (who && who.name) || '', mobile: (who && who.mobile) || '' }, true);

  const add = box.querySelector('[data-addr-new]');
  if (add) add.addEventListener('click', () => open({ name: (who && who.name) || '',
    mobile: (who && who.mobile) || '' }));

  for (const card of box.querySelectorAll('[data-addr]')) {
    const a = list.find((x) => x.id === card.dataset.addr);
    if (!a) continue;
    card.querySelector('[data-addr-edit]').addEventListener('click', () => open(a));
    const def = card.querySelector('[data-addr-default]');
    if (def) {
      def.addEventListener('click', async () => {
        try {
          await store.addresses.makeDefault(a.id);
          toast('Checkout will offer this one first');
        } catch (e) { toast(addrWhyNot(e)); }
      });
    }
    const del = card.querySelector('[data-addr-del]');
    del.addEventListener('click', async () => {
      const ok = await askFirst({
        title: 'Remove this address?',
        body: `<p><b>${esc(a.name)}</b>, ${esc(a.addr)}, ${esc(a.city)}.</p>
          <p>Orders already sent there are not affected.</p>`,
        yes: 'Remove', danger: true, no: 'Keep it',
      });
      if (!ok) return;
      try {
        await store.addresses.remove(a.id);
        toast('Address removed');
      } catch (e) { toast(addrWhyNot(e)); }
    });
  }
}

// ---------------------------------------------------------------------------
// CLEAR THIS BROWSER -- asked first, in the pop-up, because it cannot be
// undone and a single tap that destroys everything somebody typed is a
// button that will eventually be pressed by accident.
// ---------------------------------------------------------------------------
function wireClear(host) {
  const clearBtn = host.querySelector('[data-clear]');
  clearBtn.addEventListener('click', async () => {
    const ok = await askFirst({
      title: 'Clear this browser?',
      body: store.shared()
        ? '<p>Your details, bag and wishlist are taken off this browser. Your orders stay with '
          + 'us.</p><p class="ask-final">This cannot be undone.</p>'
        : '<p>Your details, bag, wishlist and every order are taken off this browser. There is '
          + 'no copy anywhere else.</p><p class="ask-final">This cannot be undone.</p>',
      yes: 'Clear everything', danger: true,
    });
    if (!ok) return;
    await store.clearEverything();
    toast('Everything cleared');
    router.go('/');
  });
}
