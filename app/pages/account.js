// ============================================================================
// Your account.
//
// Three cases, and the page says which one it is in:
//
//   ONE BROWSER  No database (config.js empty, or the single-file build): the
//                details that prefill checkout, the orders made in this
//                browser, and Clear everything. It is NOT an account and its
//                first notice says so; honesty.pl keeps that sentence here.
//   A GUEST      A database, nobody signed in. The same, plus the offer: an
//                email and a six-digit code (signin.js), so the orders placed
//                on this phone open on any phone. Never required to order.
//   SIGNED IN    Who, a Sign out, every order on the account from any phone,
//                and the address book that checkout offers.
//
// ⚠️ THERE IS STILL NO PASSWORD, AND NO SIGN-IN SCREEN OF ITS OWN. The box
// lives inside this page and two others; honesty.pl fails on a password field
// in the shop, on a login/sign-in route or screen, and on an order that stops
// being placeable as a guest.
//
// ⚠️ REGIONS, NOT ONE PAINT. 'orders' redraws the orders panel only and
// 'addresses' the address book only, so neither can wipe a code half typed
// into the sign-in box or an address half typed into its form. 'session' --
// signing in or out -- is the one change that redraws the whole page.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, h1, notice, toast } from '../ui.js';
import { field, setFieldError } from '../components.js';
import { signInBox, wireSignIn } from '../signin.js';
import { OTP_LEN } from '../config.js';
import { icon } from '../icons.js';
import * as D from '../domain.js';

const DETAILS = ['name', 'mobile', 'email', 'addr', 'city', 'state', 'pin'];
const ADDR = ['name', 'mobile', 'addr', 'city', 'state', 'pin'];

let who = null;      // as of the last full paint
let gen = 0;         // which full paint is current

router.registerScreen('account', async (host) => {
  await paint(host);
  router.onLeave(store.live.subscribe('orders', () => paintOrders(host)));
  router.onLeave(store.live.subscribe('addresses', () => paintBook(host)));
  router.onLeave(store.live.subscribe('session', () => paint(host)));
});

const inside = () => !!(who && !who.guest);

/** "Band-Collar Linen Shirt (Ecru · L) and 1 more" -- which order is which. */
function itemsLine(o) {
  const [a, ...rest] = o.lines || [];
  if (!a) return '';
  return `${a.name}${a.variantLabel ? ' (' + a.variantLabel + ')' : ''}`
    + (rest.length ? ` and ${rest.length} more` : '');
}

/** "Arrives 10–16 November" while it is on its way, "Delivered 12 November"
 *  once it is not. Read off the order; nothing here works out a date. */
function whenLine(o) {
  if (o.status === 'delivered' && o.deliveredAt) return `Delivered ${D.fmtDate(o.deliveredAt)}`;
  if (o.arrives && ['sent', 'confirmed', 'packed', 'shipped'].includes(o.status)) {
    return `Arrives ${D.fmtDateRange(o.arrives.from, o.arrives.to)}`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------
async function paint(host) {
  const mine = (gen += 1);
  const w = store.account ? await store.account.whoami() : null;
  const [orders, wishIds, shop] = await Promise.all([
    store.orders.mine(), store.wishlist.ids(), store.catalog.shop(),
  ]);
  if (mine !== gen) return;
  who = w;

  host.innerHTML = `
  ${h1(inside() ? 'Your account' : 'Your details', 'Account')}

  ${topNotice()}

  <div class="two-col" style="margin-top:var(--s5)">
    <div class="acct-col">
      ${store.account ? `<section class="panel" data-who>${whoPanel()}</section>` : ''}
      <section class="panel" data-book></section>
      <section class="panel" data-orders>${ordersPanel(orders)}</section>
    </div>

    <aside class="acct-col">
      <section class="panel" data-glance>${glancePanel(orders, wishIds)}</section>

      <section class="panel">
        <h2 class="t-h3">Clear everything</h2>
        <p class="t-micro dim" style="margin:var(--s2) 0 var(--s4)">
          ${store.shared()
            ? 'Removes your details, bag and wishlist from this browser. Orders are '
              + 'not removed: once placed, they are with us.'
            : 'Removes your details, bag, wishlist and every order from this browser. '
              + 'There is no copy anywhere else, so this cannot be undone.'}</p>
        <button type="button" class="btn btn-secondary btn-block" data-clear>
          ${icon('trash', 16)} Clear everything</button>
        <div data-confirm hidden style="margin-top:var(--s3)">
          ${notice('bad', 'This cannot be undone. Tap again to confirm.')}
        </div>
      </section>

      ${shop.contact.phone || shop.contact.email ? `
      <section class="panel">
        <h2 class="t-h3">Need a hand?</h2>
        <p class="t-micro dim" style="margin-top:var(--s2)">
          We answer during ${esc(shop.contact.hours)}.</p>
        <div style="margin-top:var(--s3)">
          <a class="btn btn-secondary btn-sm btn-block" href="#/contact">Contact us</a>
        </div>
      </section>` : ''}
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

function whoPanel() {
  if (inside()) {
    return `
      <h2 class="t-h3">Signed in</h2>
      <p class="acct-who">${icon('user', 18)}<b>${esc(who.email)}</b></p>
      <p class="t-micro dim" style="margin-top:var(--s2)">
        Your orders and addresses open on any phone where you sign in with this email.</p>
      <button type="button" class="btn btn-secondary btn-sm" style="margin-top:var(--s4)"
        data-signout>Sign out</button>`;
  }
  return `
    <h2 class="t-h3">Sign in</h2>
    <div style="margin-top:var(--s3)">
      ${signInBox(`Sign in with your email and we send you a ${OTP_LEN}-digit code — there
        is no password. Your orders and saved addresses then open on any phone, not
        only this one. You never need to sign in to order.`)}
    </div>`;
}

function glancePanel(orders, wishIds) {
  return `
    <h2 class="t-h3">At a glance</h2>
    <div class="totals" style="margin-top:var(--s4)">
      <div class="total-row muted"><span>Saved styles</span><span>${wishIds.length}</span></div>
      <div class="total-row muted"><span>${inside() ? 'Orders' : 'Orders here'}</span>
        <span>${orders.length}</span></div>
      ${store.shared() ? '' : `<div class="total-row muted"><span>Not yet sent</span>
        <span>${orders.filter((o) => o.status === 'draft').length}</span></div>`}
    </div>
    <div style="margin-top:var(--s4);display:flex;flex-direction:column;gap:var(--s2)">
      <a class="btn btn-secondary btn-sm" href="#/wishlist">View wishlist</a>
      <a class="btn btn-secondary btn-sm" href="#/cart">View bag</a>
    </div>`;
}

// ---------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------
function ordersPanel(orders) {
  const head = inside() ? 'Your orders'
    : store.shared() ? 'Orders placed on this phone' : 'Orders from this browser';
  return `
    <h2 class="t-h3">${head}</h2>
    ${orders.length ? orders.map((o) => `
      <div class="ord">
        <div>
          <a href="#/order/${esc(o.code)}" class="ord-code">${esc(o.code)}</a>
          <div class="ord-meta">${D.fmtStamp(o.createdAt)} ·
            ${o.lines.length} ${o.lines.length === 1 ? 'line' : 'lines'} ·
            ${D.rupees(o.grand)}</div>
          <div class="ord-meta">${esc(itemsLine(o))}</div>
          ${whenLine(o) ? `<div class="ord-meta">${esc(whenLine(o))}</div>` : ''}
        </div>
        <span class="pill pill-${D.STATUS_TONE[o.status]}">
          ${esc(D.STATUS_LABEL[o.status])}</span>
      </div>`).join('')
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
  const [orders, wishIds] = await Promise.all([store.orders.mine(), store.wishlist.ids()]);
  const box = host.querySelector('[data-orders]');
  if (box) box.innerHTML = ordersPanel(orders);
  const glance = host.querySelector('[data-glance]');
  if (glance) glance.innerHTML = glancePanel(orders, wishIds);
}

// ---------------------------------------------------------------------------
// THE ADDRESS BOOK when signed in; this browser's details otherwise.
// ---------------------------------------------------------------------------
async function paintBook(host) {
  const box = host.querySelector('[data-book]');
  if (!box) return;
  if (!inside()) {
    box.innerHTML = detailsPanel(await store.profile.get());
    wireDetails(box);
    return;
  }
  let list;
  try {
    list = await store.addresses.list();
  } catch (e) {
    box.innerHTML = '<h2 class="t-h3">Your addresses</h2>'
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
      <h2 class="t-h3">Your addresses</h2>
      ${list.length < MAX_ADDR ? `<button type="button" class="btn btn-secondary btn-sm"
        data-addr-new>${icon('plus', 14)} Add an address</button>` : ''}
    </div>
    <div data-addr-form hidden></div>
    ${list.length ? `<div class="book">${list.map(addrCard).join('')}</div>`
      : `<p class="t-micro dim" style="margin-top:var(--s3)">No addresses saved yet. Add one
          here, or keep "Save this address" ticked when you next check out.</p>`}
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

function addrForm(a) {
  return `
    <div class="addr-form">
      <h3 class="t-h3">${a.id ? 'Change this address' : 'A new address'}</h3>
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
      <label class="tick"><input type="checkbox" data-ab-default
        ${a.isDefault ? 'checked disabled' : ''}> Offer this one first at checkout</label>
      <div class="addr-form-acts">
        <button type="button" class="btn btn-primary" data-ab-save>Save address</button>
        <button type="button" class="btn btn-secondary" data-ab-cancel>Cancel</button>
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

/** A two-tap confirm, inline -- never window.confirm(), which some viewers
 *  answer "no" to without showing anything (admin.js has the story). */
function armed(btn, prompt) {
  if (btn.dataset.armed === '1') return true;
  btn.dataset.armed = '1';
  const was = btn.textContent;
  btn.textContent = prompt;
  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.dataset.armed = '0';
    btn.textContent = was;
  }, 4000);
  return false;
}

function wireBook(box, list) {
  const formBox = box.querySelector('[data-addr-form]');

  const open = (a) => {
    formBox.innerHTML = addrForm(a);
    formBox.hidden = false;
    formBox.querySelector('[name="ab-name"]').focus();
    formBox.querySelector('[data-ab-cancel]').addEventListener('click', () => {
      formBox.hidden = true;
      formBox.innerHTML = '';
    });
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
        const first = formBox.querySelector('.field.bad input, .field.bad select, .field.bad textarea');
        if (first) first.focus();
        toast('Please check the highlighted fields');
        return;
      }
      save.disabled = true;
      try {
        await store.addresses.save({ ...v, id: a.id,
          isDefault: formBox.querySelector('[data-ab-default]').checked });
        toast(a.id ? 'Address changed' : 'Address saved');
        // 'addresses' has fired: the book is being redrawn with it.
      } catch (e) {
        save.disabled = false;
        toast(addrWhyNot(e));
      }
    });
  };

  const add = box.querySelector('[data-addr-new]');
  if (add) add.addEventListener('click', () => open({}));

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
      if (!armed(del, 'Tap again to remove')) return;
      try {
        await store.addresses.remove(a.id);
        toast('Address removed');
      } catch (e) { toast(addrWhyNot(e)); }
    });
  }
}

// ---------------------------------------------------------------------------
// CLEAR EVERYTHING -- two taps, as in kirana. A single-tap destroy of
// everything somebody has typed is a button that will eventually be pressed
// by accident.
// ---------------------------------------------------------------------------
function wireClear(host) {
  let isArmed = false;
  const clearBtn = host.querySelector('[data-clear]');
  clearBtn.addEventListener('click', async () => {
    const box = host.querySelector('[data-confirm]');
    if (!isArmed) {
      isArmed = true;
      box.hidden = false;
      clearBtn.textContent = 'Tap again to clear everything';
      setTimeout(() => {
        isArmed = false; box.hidden = true;
        clearBtn.innerHTML = icon('trash', 16) + ' Clear everything';
      }, 5000);
      return;
    }
    await store.clearEverything();
    toast('Everything cleared');
    router.go('/');
  });
}
