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
// ⚠️ NO <form action>. There is nothing to POST to. tools/honesty.pl fails on
// one, because that is the shape a fake submission takes.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, h1, emptyState, notice, toast } from '../ui.js';
import { field, setFieldError } from '../components.js';
import { signInBox, wireSignIn } from '../signin.js';
import { payOptions, demoStrip } from '../pay.js';
import { seal } from '../brand.js';
import { icon } from '../icons.js';
import * as D from '../domain.js';

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
  const gw = D.gatewayState(shop.gateway);

  // UPI first — it is the one that actually works today.
  let pay = 'upi';

  // Who is ordering. A guest is OFFERED a sign-in, never asked for one -- the
  // order goes through either way. An account is offered its saved addresses,
  // the default first, and "a new address" below them.
  const who = store.account ? await store.account.whoami() : null;
  const signedIn = !!(who && !who.guest);
  let book = [];
  if (signedIn) {
    try { book = await store.addresses.list(); } catch (e) { book = []; }
  }
  let shipTo = book.length ? (book.find((a) => a.isDefault) || book[0]).id : 'new';

  host.innerHTML = `
  ${h1('Checkout', 'Almost there')}

  ${store.shared() ? notice('info', '<b>Your order comes straight to us</b> the '
    + 'moment you place it. This page does not take payment: pay by UPI with the '
    + 'QR on the next page, or in cash to the courier.') : notice('warn', '<b>This page does not take payment and cannot send your '
    + 'order.</b> Saving it creates a record in this browser with an order '
    + 'code. The next screen is where you hand it to us — on WhatsApp, by '
    + 'phone or by email — and nothing reaches ' + esc(shop.brand.name)
    + ' until you do.')}

  <div class="two-col" style="margin-top:var(--s5)">
    <div>
      <section class="panel">
        <h3 class="t-h3">Where it goes</h3>
        ${store.account && !signedIn ? `
          <p class="co-offer">Ordered from us before?
            <button type="button" class="btn-ghost" data-co-open>Sign in</button>
            to use a saved address — or just fill this in. No account needed.</p>
          <div class="co-signin" data-co-box hidden></div>` : ''}
        ${signedIn ? `<p class="co-who">Signed in as <b>${esc(who.email)}</b></p>` : ''}
        ${book.length ? `
          <div class="co-book" data-book role="radiogroup" aria-label="Saved addresses">
            ${book.map((a) => shipOpt(a, shipTo)).join('')}
            ${shipNew(shipTo)}
          </div>` : ''}
        <div data-newaddr ${shipTo === 'new' ? '' : 'hidden'}>
          <div class="form-grid">
            ${field('name', 'Full name', { required: true, value: profile.name, span: true })}
            ${field('mobile', 'Mobile number', { required: true, value: profile.mobile,
              type: 'tel', inputmode: 'numeric', placeholder: '10 digits', maxlength: 13 })}
            ${field('email', 'Email', { value: profile.email || (signedIn ? who.email : ''),
              type: 'email', placeholder: 'For the order confirmation' })}
            ${field('addr', 'Address', { required: true, value: profile.addr, rows: 3,
              span: true, placeholder: 'Flat, building, street, area' })}
            ${field('city', 'City', { required: true, value: profile.city })}
            ${field('pin', 'PIN code', { required: true, value: profile.pin,
              inputmode: 'numeric', maxlength: 6 })}
            ${field('state', 'State', { required: true, value: profile.state,
              options: D.STATES, span: true })}
          </div>
          ${signedIn ? `<label class="tick co-save"><input type="checkbox" data-co-save checked>
            <span>Save this address to my account</span></label>` : ''}
        </div>
      </section>

      <section class="panel" style="margin-top:var(--s4)">
        <h3 class="t-h3">How you would like to pay</h3>
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
          ${store.shared() ? 'Place order' : 'Save this order'}</button>
        <p class="t-micro dim" style="margin-top:var(--s3);text-align:center">
          ${store.shared()
            ? 'We confirm every order by hand, and the next page shows it when we have.'
            : 'You will be able to send it to us on the next screen.'}</p>
      </div>

      <div style="margin-top:var(--s4)">
        <a class="btn-ghost" href="#/cart">${icon('left', 14)} Back to the bag</a>
      </div>
    </aside>
  </div>`;

  paintPayNote();

  // -------------------------------------------------------------------------
  function paintPayNote() {
    const box = host.querySelector('[data-paynote]');
    if (pay === 'upi') {
      box.innerHTML = demoStrip(shop.upi)
        || notice('info', 'A QR with the exact amount and your order code '
          + 'appears on the next screen.');
    } else if (pay === 'cod') {
      box.innerHTML = notice('info', 'Pay the courier when the parcel arrives. '
        + 'We will still need you to send the order through so we can confirm it.');
    } else {
      box.innerHTML = notice('warn', esc(gw.why));
    }
  }

  host.querySelector('[data-pay]').addEventListener('change', (e) => {
    if (e.target.name !== 'pay') return;
    pay = e.target.value;
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
      host.querySelector('[data-newaddr]').hidden = shipTo !== 'new';
    });
  }

  // The offer to sign in: opened in place, so the bag and whatever has been
  // typed so far stay where they are.
  const offer = host.querySelector('[data-co-open]');
  if (offer) {
    offer.addEventListener('click', () => {
      const box = host.querySelector('[data-co-box]');
      if (!box.hidden) { box.hidden = true; return; }
      box.innerHTML = signInBox('');
      box.hidden = false;
      wireSignIn(box, async () => {
        // Redrawn signed in, with the saved addresses. What was typed is kept
        // in this browser first, so the form comes back filled.
        await store.profile.save(readForm());
        router.repaint();
      });
      box.querySelector('[data-si-email]').focus();
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
      if (p && p.kind !== 'voucher' && lines[i].qty > p.stock) {
        toast(`Only ${p.stock} of ${p.name} left — please adjust your bag.`);
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
      return;
    }
    // Kept to the account only once the order is in: an order that failed
    // must not leave an address behind it. Best effort -- the order is what
    // matters, and the address can be added on the account page.
    const keep = host.querySelector('[data-co-save]');
    if (signedIn && typed && keep && keep.checked) {
      try { await store.addresses.save(v); } catch (e) { console.warn('[vastra] address not kept', e); }
    }
    router.go(`/order/${order.code}`);
  });
});

/** A saved address as a choice, in the same card as the ways to pay. */
const shipOpt = (a, sel) => `
  <label class="pay-opt${a.id === sel ? ' on' : ''}">
    <input type="radio" name="shipto" value="${esc(a.id)}" ${a.id === sel ? 'checked' : ''}>
    <span>
      <span class="pay-name">${esc(a.name)}${a.isDefault
        ? ' <span class="pill pill-good">Default</span>' : ''}</span>
      <span class="pay-why">${esc(a.addr)}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.pin)}
        · ${esc(a.mobile)}</span>
    </span>
  </label>`;

const shipNew = (sel) => `
  <label class="pay-opt${sel === 'new' ? ' on' : ''}">
    <input type="radio" name="shipto" value="new" ${sel === 'new' ? 'checked' : ''}>
    <span>
      <span class="pay-name">A new address</span>
      <span class="pay-why">Type it in below.</span>
    </span>
  </label>`;

/** What to say when an order did not go through: in words, and with the bag
 *  left exactly as it was, because losing it is worse than a failed tap. */
function whyNot(e) {
  const m = String((e && e.message) || e);
  if (/TOO_MANY_ORDERS/.test(m)) return 'That is a lot of orders in one hour. Please wait a while, or write to us.';
  if (/GONE_FROM_CATALOGUE/.test(m)) return 'Something in your bag is no longer sold. Please check your bag.';
  if (/fetch|network|BLOCKED|NO_SESSION|Load failed|anonymous/i.test(m)) {
    return 'We could not reach the shop just now. Your bag is still here; please try again.';
  }
  return 'The order did not go through: ' + m;
}
