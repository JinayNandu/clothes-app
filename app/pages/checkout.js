// ============================================================================
// Checkout.
//
// ⚠️ The button says what it does, and what it does depends on whether a
// database is connected. With none it says "Save this order": an order the
// shop has never seen is not placed, and the next screen is where it is
// handed over. With one it says "Place order", because then that is true --
// the order is with the shop when the call returns. Never "Pay now": nothing
// here takes money.
//
// ⚠️ SIGNED IN TO ORDER, since 8 November 2026 -- the owner's call: "a person
// cannot order unless they are signed in, because how will they ever view
// that order again". With accounts on (config.js SIGN_IN and
// SIGN_IN_TO_ORDER), the first step is the email and its code, in place on
// this page -- never a screen of its own (honesty.pl) -- and then the
// account's saved addresses, with a new one saved to the account as the
// order goes through. A page rule only: the server still takes a guest, so
// turning SIGN_IN_TO_ORDER off brings guest checkout back at once.
//
// ⚠️ NO <form action>. There is nothing to POST to. tools/honesty.pl fails on
// one, because that is the shape a fake submission takes.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, h1, emptyState, notice, toast } from '../ui.js';
import { field, setFieldError } from '../components.js';
import { signInBox, wireSignIn } from '../signin.js';
import { SIGN_IN_TO_ORDER, OTP_LEN } from '../config.js';
import { payOptions } from '../pay.js';
import { seal } from '../brand.js';
import { icon } from '../icons.js';
import * as D from '../domain.js';

const MAX_ADDR = 10;   // the same ceiling as save_address() in db/schema.sql

// The way to pay picked before signing in survives the repaint that follows.
let lastPay = 'upi';

router.registerScreen('checkout', async (host) => {
  const [lines, shop, profile, coupon] = await Promise.all([
    store.cart.lines(), store.catalog.shop(),
    store.profile.get(), store.cart.coupon(),
  ]);

  if (!lines.length) {
    host.innerHTML = h1('Checkout', 'Shopping')
      + emptyState(seal(64), 'There is nothing to check out.',
        'Your bag is empty. Everything is cut in batches, so it is worth a look before a size goes.',
        'Shop all', '#/shop');
    return;
  }

  const t = await store.cart.totals();
  const products = await Promise.all(lines.map((l) => store.catalog.byId(l.pid)));

  let pay = lastPay;

  // Who is ordering. With accounts on, a guest signs in first; an account is
  // offered its saved addresses, the default first, and "a new address".
  const who = store.account ? await store.account.whoami() : null;
  const signedIn = !!(who && !who.guest);
  const mustSignIn = !!store.account && SIGN_IN_TO_ORDER && !signedIn;
  let book = [];
  if (signedIn) {
    try { book = await store.addresses.list(); } catch (e) { book = []; }
  }
  let shipTo = book.length ? (book.find((a) => a.isDefault) || book[0]).id : 'new';
  // A new address starts from the account's own name and mobile, then this
  // browser's details.
  const start = {
    ...profile,
    name: (who && who.name) || profile.name,
    mobile: (who && who.mobile) || profile.mobile,
  };

  host.innerHTML = `
  ${h1('Checkout', 'Almost there')}

  ${store.shared() ? notice('info', '<b>Your order comes straight to us</b> the '
    + 'moment you place it. This page does not take payment: pay by UPI with the '
    + 'QR on the next page, or pay the delivery partner in cash or by UPI.') : notice('warn', '<b>This page does not take payment and cannot send your '
    + 'order.</b> Saving it creates a record in this browser with an order '
    + 'code. The next screen is where you hand it to us — on WhatsApp, by '
    + 'phone or by email — and nothing reaches ' + esc(shop.brand.name)
    + ' until you do.')}

  <div class="two-col" style="margin-top:var(--s5)">
    <div>
      <section class="panel co-step" data-where>
        ${mustSignIn ? signInStep() : whereStep()}
      </section>

      <section class="panel co-step" style="margin-top:var(--s4)">
        <h3 class="t-h3">${signedIn ? '<span class="co-n">2</span>' : ''}How you would like to pay</h3>
        <div data-pay>${payOptions(shop, pay)}</div>
        <div style="margin-top:var(--s4)" data-paynote></div>
      </section>
    </div>

    <aside class="panel panel-sticky">
      <h3 class="t-h3">Your order</h3>
      <div style="display:flex;flex-direction:column;gap:var(--s2);margin-bottom:var(--s4)">
        ${lines.map((l, i) => {
          const p = products[i];
          if (!p) return '';
          const label = D.variantLabel(p, l.variant);
          const unit = D.variantPrice(p, l.variant);
          return `<div class="total-row muted">
            <span>${l.qty} &times; ${esc(p.name)}${label
              ? `<br><span class="t-micro dim">${esc(label)}</span>` : ''}</span>
            <span>${D.rupees(unit * l.qty)}</span></div>`;
        }).join('')}
      </div>

      <div class="totals">
        <div class="total-row muted"><span>Items</span><span>${D.rupees(t.items)}</span></div>
        ${t.discount ? `<div class="total-row save">
          <span>Coupon ${esc(coupon ? coupon.code : '')}</span>
          <span>&minus;${D.rupees(t.discount)}</span></div>` : ''}
        <div class="total-row muted"><span>Shipping</span>
          <span>${t.shipping ? D.rupees(t.shipping)
            : (t.physical === 0 ? 'Nothing to ship' : 'Free')}</span></div>
        ${t.bulky ? `<div class="total-row muted">
          <span>Bulky item handling</span><span>${D.rupees(t.bulky)}</span></div>` : ''}
        <div class="total-row grand"><span>Payable</span><span>${D.rupees(t.grand)}</span></div>
      </div>

      <div style="margin-top:var(--s5)">
        <button type="button" class="btn btn-primary btn-block" data-save>
          ${mustSignIn ? 'Sign in to place your order'
            : store.shared() ? 'Place order' : 'Save this order'}</button>
        <p class="t-micro dim" style="margin-top:var(--s3);text-align:center">
          ${mustSignIn
            ? 'Sign in above first: your email, then the code we send you.'
            : store.shared()
              ? 'We confirm every order by hand, and the next page shows it when we have.'
              : 'You will be able to send it to us on the next screen.'}</p>
      </div>

      <div style="margin-top:var(--s4)">
        <a class="btn-ghost" href="#/cart">${icon('left', 14)} Back to the bag</a>
      </div>
    </aside>
  </div>`;

  /** Step one for somebody not signed in: who they are. */
  function signInStep() {
    return `
      <h3 class="t-h3"><span class="co-n">1</span>Sign in to place your order</h3>
      <p class="co-why">So this order — and where it has got to — opens on any phone where
        you sign in. We email you a ${OTP_LEN}-digit code; there is no password. Your saved
        addresses come with it.</p>
      <div data-co-box>${signInBox('')}</div>`;
  }

  /** Where it goes: a saved address, or a new one -- saved to the account as
   *  the order goes through. */
  function whereStep() {
    const full = book.length >= MAX_ADDR;
    return `
      <h3 class="t-h3">${signedIn ? '<span class="co-n">1</span>' : ''}${signedIn
        ? 'Deliver to' : 'Where it goes'}</h3>
      ${signedIn ? `<p class="co-who">${icon('user', 14)} Signed in as <b>${esc(who.email)}</b></p>` : ''}
      ${book.length ? `
        <div class="co-book" data-book role="radiogroup" aria-label="Saved addresses">
          ${book.map((a) => shipOpt(a, shipTo)).join('')}
          ${full ? '' : shipNew(shipTo)}
        </div>` : ''}
      <div data-newaddr ${shipTo === 'new' ? '' : 'hidden'}>
        ${signedIn && !book.length ? `<p class="co-why">Add the address it goes to. It is saved
          to your account with the order, so next time you only pick it.</p>` : ''}
        <div class="form-grid">
          ${field('name', 'Full name', { required: true, value: start.name, span: true })}
          ${field('mobile', 'Mobile number', { required: true, value: start.mobile,
            type: 'tel', inputmode: 'numeric', placeholder: '10 digits', maxlength: 13 })}
          ${signedIn ? '' : field('email', 'Email', { value: start.email,
            type: 'email', placeholder: 'For the order confirmation' })}
          ${field('addr', 'Address', { required: true, value: start.addr, rows: 3,
            span: true, placeholder: 'Flat, building, street, area' })}
          ${field('city', 'City', { required: true, value: start.city })}
          ${field('pin', 'PIN code', { required: true, value: start.pin,
            inputmode: 'numeric', maxlength: 6 })}
          ${field('state', 'State', { required: true, value: start.state,
            options: D.STATES, span: true })}
        </div>
        ${signedIn && book.length ? `<p class="co-saved">${icon('check', 14)}
          Saved to your account with the order.</p>` : ''}
      </div>`;
  }

  paintPayNote();

  // -------------------------------------------------------------------------
  function paintPayNote() {
    const box = host.querySelector('[data-paynote]');
    if (pay === 'upi') {
      box.innerHTML = notice('info', 'A QR with the exact amount and your order code '
        + 'appears on the next screen. After paying, keep the screenshot: show it to '
        + 'the delivery partner when your parcel arrives.');
    } else {
      box.innerHTML = notice('info', 'Pay the delivery partner when the parcel arrives, '
        + 'in cash or by UPI.'
        + (store.shared() ? ''
          : ' We will still need you to send the order through so we can confirm it.'));
    }
  }

  host.querySelector('[data-pay]').addEventListener('change', (e) => {
    if (e.target.name !== 'pay') return;
    pay = lastPay = e.target.value;
    // Scoped to the pay cards: the saved addresses wear the same class.
    for (const l of host.querySelectorAll('[data-pay] .pay-opt')) {
      l.classList.toggle('on', l.querySelector('input').checked);
    }
    paintPayNote();
  });

  // A saved address, or a new one typed below.
  const bookEl = host.querySelector('[data-book]');
  if (bookEl) {
    bookEl.addEventListener('change', (e) => {
      if (e.target.name !== 'shipto') return;
      shipTo = e.target.value;
      for (const l of bookEl.querySelectorAll('.pay-opt')) {
        l.classList.toggle('on', l.querySelector('input').checked);
      }
      const nb = host.querySelector('[data-newaddr]');
      nb.hidden = shipTo !== 'new';
      if (!nb.hidden) nb.querySelector('[name="name"]').focus();
    });
  }

  // Signing in, in place. Once the code is accepted the page is drawn again,
  // signed in, with the account's addresses.
  const siBox = host.querySelector('[data-co-box]');
  if (siBox) {
    wireSignIn(siBox, (w) => {
      toast(w.moved
        ? `Signed in. ${w.moved} earlier ${w.moved === 1 ? 'order' : 'orders'} came with you.`
        : `Signed in as ${w.email}. Now, where should it go?`);
      router.repaint();
    });
  }

  // -------------------------------------------------------------------------
  // VALIDATION — every message says what to do, not that something is wrong.
  // -------------------------------------------------------------------------
  function readForm() {
    const v = {};
    for (const n of ['name', 'mobile', 'email', 'addr', 'city', 'state', 'pin']) {
      const el = host.querySelector(`[name="${n}"]`);
      v[n] = el ? el.value.trim() : '';
    }
    // Signed in, the order's email is the account's: there is no field.
    if (signedIn) v.email = who.email || '';
    return v;
  }

  /** Where the parcel goes: the saved address chosen, or the form. */
  function read() {
    const a = shipTo !== 'new' && book.find((x) => x.id === shipTo);
    if (!a) return readForm();
    return { name: a.name, mobile: a.mobile, email: (who && who.email) || '',
             addr: a.addr, city: a.city, state: a.state, pin: a.pin };
  }

  /** `mark`: show the errors on the form's fields. A saved address has no
   *  fields on screen to mark. */
  function validate(v, mark) {
    const errs = {};
    if (v.name.length < 2) errs.name = 'We need a name for the parcel.';
    if (!D.validMobile(v.mobile)) errs.mobile = 'A 10-digit Indian mobile, starting 6 to 9.';
    if (v.email && !D.validEmail(v.email)) errs.email = 'That does not look like an email address.';
    if (v.addr.length < 10) errs.addr = 'Flat or house number, building, street and area.';
    if (!v.city) errs.city = 'Which city?';
    if (!v.state) errs.state = 'Choose a state.';
    if (!D.validPin(v.pin)) errs.pin = 'Six digits, not starting with zero.';
    if (mark) {
      for (const n of ['name', 'mobile', 'email', 'addr', 'city', 'state', 'pin']) {
        setFieldError(host, n, errs[n] || null);
      }
    }
    return errs;
  }

  host.querySelector('[data-save]').addEventListener('click', async () => {
    if (mustSignIn) {
      const email = host.querySelector('[data-co-box] [data-si-email]');
      const where = host.querySelector('[data-where]');
      where.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (email && !email.closest('[hidden]')) email.focus({ preventScroll: true });
      toast('Sign in first: your email, then the code we send you.');
      return;
    }
    const v = read();
    const typed = shipTo === 'new';
    const errs = validate(v, typed);
    if (Object.keys(errs).length) {
      if (!typed) {
        toast('That saved address is missing something. Choose another, or a new one.');
        return;
      }
      const first = host.querySelector('.field.bad input, .field.bad select, .field.bad textarea');
      if (first) { first.focus(); first.scrollIntoView({ block: 'center' }); }
      toast('Please check the highlighted fields');
      return;
    }

    // Stock is re-checked HERE, not only when the item went in the bag. A
    // basket can sit open across a sell-out.
    for (let i = 0; i < lines.length; i++) {
      const p = products[i];
      const left = D.skuStock(p, lines[i].variant);
      if (p && p.kind !== 'voucher' && lines[i].qty > left) {
        toast(`Only ${left} of ${p.name}${D.variantLabel(p, lines[i].variant) ? ' (' + D.variantLabel(p, lines[i].variant) + ')' : ''} left — please adjust your bag.`);
        router.go('/cart');
        return;
      }
    }

    await store.profile.save(v);
    // ⚠️ Disabled for the length of the call: on a database, a second tap is a
    // second order. place() sets the status and paid itself -- 'draft' in one
    // browser, 'sent' on the server -- and cannot be told otherwise.
    const btn = host.querySelector('[data-save]');
    btn.disabled = true;
    let order;
    try {
      order = await store.orders.place({ customer: v, payMethod: pay });
    } catch (e) {
      btn.disabled = false;
      toast(whyNot(e));
      // A price changed, or the stock ran out, since this page read the
      // catalogue (8 November 2026: the server checks both now). Read it
      // again, and back to the bag, which shows today's prices and what
      // is left of each size.
      if (/PRICE_CHANGED|OUT_OF_STOCK|GONE_FROM_CATALOGUE/.test(String((e && e.message) || e))) {
        await store.refreshCatalogue();
        router.go('/cart');
        return;
      }
      // The account this phone was signed in to no longer exists, and the
      // backend has taken it off: drawn again, the page asks to sign in.
      if (/ACCOUNT_GONE/.test(String((e && e.message) || e))) router.repaint();
      return;
    }
    // Kept to the account once the order is in -- an order that failed must
    // not leave an address behind, or a second try would save it twice. No
    // tick box any more: the owner wants it saved (8 November 2026). Not when
    // the same address is already there, or the book is full. Best effort:
    // the order is what matters, and the address can be added on the profile.
    if (signedIn && typed) {
      const same = (a) => ['name', 'mobile', 'addr', 'city', 'state', 'pin']
        .every((k) => String(a[k] || '').trim().toLowerCase() === String(v[k] || '').trim().toLowerCase());
      if (!book.some(same) && book.length < MAX_ADDR) {
        try { await store.addresses.save(v); } catch (e) { console.warn('[vastra] address not kept', e); }
      }
      // The account's own name and mobile, the first time there are any.
      if (who && !who.name && store.account.saveDetails) {
        try { await store.account.saveDetails({ name: v.name, mobile: v.mobile }); } catch (e) {
          console.warn('[vastra] details not kept', e);
        }
      }
    }
    router.go(`/order/${order.code}`);
  });
});

/** A saved address as a choice, in the same card as the ways to pay. The
 *  mobile sits beside the name -- "who, and how to reach them" -- not after
 *  the PIN code, where the owner found it hard to read (8 November 2026). */
const shipOpt = (a, sel) => `
  <label class="pay-opt${a.id === sel ? ' on' : ''}">
    <input type="radio" name="shipto" value="${esc(a.id)}" ${a.id === sel ? 'checked' : ''}>
    <span>
      <span class="pay-name">${esc(a.name)}<span class="ship-tel">${esc(D.fmtMobile(a.mobile))}</span>${a.isDefault
        ? ' <span class="pill pill-good">Default</span>' : ''}</span>
      <span class="pay-why">${esc(a.addr)}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.pin)}</span>
    </span>
  </label>`;

const shipNew = (sel) => `
  <label class="pay-opt${sel === 'new' ? ' on' : ''}">
    <input type="radio" name="shipto" value="new" ${sel === 'new' ? 'checked' : ''}>
    <span>
      <span class="pay-name co-new">${icon('plus', 14)} Add a new address</span>
      <span class="pay-why">Another place, or another name and number.</span>
    </span>
  </label>`;

/** What to say when an order did not go through: in words, and with the bag
 *  left exactly as it was, because losing it is worse than a failed tap. */
function whyNot(e) {
  const m = String((e && e.message) || e);
  if (/ACCOUNT_GONE/.test(m)) return 'This phone was signed in to an account that no longer exists. Sign in again; your bag is still here.';
  if (/TOO_MANY_ORDERS/.test(m)) return 'That is a lot of orders in one hour. Please wait a while, or write to us.';
  if (/GONE_FROM_CATALOGUE/.test(m)) return 'Something in your bag is no longer sold. Please check your bag.';
  if (/PRICE_CHANGED/.test(m)) return 'A price in your bag changed since you opened the shop. Your bag shows the new price now; please check it and order again.';
  if (/OUT_OF_STOCK/.test(m)) return 'Some of your bag sold out while you were choosing. Please check your bag.';
  if (/fetch|network|BLOCKED|NO_SESSION|Load failed|anonymous/i.test(m)) {
    return 'We could not reach the shop just now. Your bag is still here; please try again.';
  }
  return 'The order did not go through: ' + m;
}
