// ============================================================================
// My Account — which is NOT an account, and says so in its first line.
//
// ⚠️ THERE IS DELIBERATELY NO LOGIN, SIGN-UP OR OTP SCREEN ANYWHERE IN THIS
// PROJECT. A login form that accepts any password is the single most dishonest
// thing this site could ship, and it is also the easiest to build by accident
// while "scaffolding". tools/honesty.pl fails on a route, screen or section id
// named login, signin, signup, register or otp.
//
// What this page is instead: the details that prefill checkout, the orders
// created in this browser, and the Clear everything button — which is the only
// "log out" there is when everything lives in one browser, and is what makes
// demonstrating the same flow twice possible.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, h1, notice, toast } from '../ui.js';
import { field, setFieldError } from '../components.js';
import { icon } from '../icons.js';
import * as D from '../domain.js';

router.registerScreen('account', async (host) => {
  await paint(host);
  router.onLeave(store.live.subscribe('orders', () => paint(host)));
});

async function paint(host) {
  const [profile, orders, wishIds, shop] = await Promise.all([
    store.profile.get(), store.orders.mine(),
    store.wishlist.ids(), store.catalog.shop(),
  ]);

  host.innerHTML = `
  ${h1('Your details', 'Account')}

  ${notice('info', '<b>This is not an account.</b> There is no login here, '
    + 'because there is no server to hold a password. Your details, your '
    + 'wishlist and your orders are saved in this browser only — clearing your '
    + 'browser data erases all of it, and opening this site on another device '
    + 'shows an empty one.')}

  <div class="two-col" style="margin-top:var(--s5)">
    <div>
      <section class="panel">
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
        </div>
      </section>

      <section class="panel" style="margin-top:var(--s4)">
        <h2 class="t-h3">Orders from this browser</h2>
        ${orders.length ? orders.map((o) => `
          <div class="ord">
            <div>
              <a href="#/order/${esc(o.code)}" class="ord-code">${esc(o.code)}</a>
              <div class="ord-meta">${D.fmtStamp(o.createdAt)} ·
                ${o.lines.length} ${o.lines.length === 1 ? 'line' : 'lines'} ·
                ${D.rupees(o.grand)}</div>
            </div>
            <span class="pill pill-${D.STATUS_TONE[o.status]}">
              ${esc(D.STATUS_LABEL[o.status])}</span>
          </div>`).join('')
        : `<p class="t-micro dim" style="margin-top:var(--s3)">
            No orders yet. When you place one you will be able to reopen it here
            — including the QR and the send buttons.</p>`}
        ${orders.some((o) => o.status === 'draft') ? `
          <div style="margin-top:var(--s4)">
            ${notice('warn', 'One or more of these has not been sent to us yet. '
              + 'Open it and use the send buttons, or it stays here and nowhere else.')}
          </div>` : ''}
      </section>
    </div>

    <aside>
      <section class="panel">
        <h2 class="t-h3">At a glance</h2>
        <div class="totals" style="margin-top:var(--s4)">
          <div class="total-row muted"><span>Saved pieces</span>
            <span>${wishIds.length}</span></div>
          <div class="total-row muted"><span>Orders here</span>
            <span>${orders.length}</span></div>
          <div class="total-row muted"><span>Not yet sent</span>
            <span>${orders.filter((o) => o.status === 'draft').length}</span></div>
        </div>
        <div style="margin-top:var(--s4);display:flex;flex-direction:column;gap:var(--s2)">
          <a class="btn btn-secondary btn-sm" href="#/wishlist">View wishlist</a>
          <a class="btn btn-secondary btn-sm" href="#/cart">View bag</a>
        </div>
      </section>

      <section class="panel" style="margin-top:var(--s4)">
        <h2 class="t-h3">Clear everything</h2>
        <p class="t-micro dim" style="margin:var(--s2) 0 var(--s4)">
          Removes your details, bag, wishlist and every order from this browser.
          There is no copy anywhere else, so this cannot be undone.</p>
        <button type="button" class="btn btn-secondary btn-block" data-clear>
          ${icon('trash', 16)} Clear everything</button>
        <div data-confirm hidden style="margin-top:var(--s3)">
          ${notice('bad', 'This cannot be undone. Tap again to confirm.')}
        </div>
      </section>

      ${shop.contact.phone || shop.contact.email ? `
      <section class="panel" style="margin-top:var(--s4)">
        <h2 class="t-h3">Need a hand?</h2>
        <p class="t-micro dim" style="margin-top:var(--s2)">
          We answer during ${esc(shop.contact.hours)}.</p>
        <div style="margin-top:var(--s3)">
          <a class="btn btn-secondary btn-sm btn-block" href="#/contact">Contact us</a>
        </div>
      </section>` : ''}
    </aside>
  </div>`;

  // -------------------------------------------------------------------------
  host.querySelector('[data-save]').addEventListener('click', async () => {
    const v = {};
    for (const n of ['name', 'mobile', 'email', 'addr', 'city', 'state', 'pin']) {
      const el = host.querySelector(`[name="${n}"]`);
      v[n] = el ? el.value.trim() : '';
    }
    // Lighter than checkout: this is a convenience, and a half-filled profile
    // is a perfectly reasonable thing to save.
    const errs = {};
    if (v.mobile && !D.validMobile(v.mobile)) errs.mobile = 'A 10-digit Indian mobile.';
    if (v.email && !D.validEmail(v.email)) errs.email = 'That does not look like an email.';
    if (v.pin && !D.validPin(v.pin)) errs.pin = 'Six digits, not starting with zero.';
    for (const n of ['mobile', 'email', 'pin']) setFieldError(host, n, errs[n] || null);
    if (Object.keys(errs).length) { toast('Please check the highlighted fields'); return; }

    await store.profile.save(v);
    toast('Saved in this browser');
  });

  // Two taps, as in kirana. A single-tap destroy of everything somebody has
  // typed is a button that will eventually be pressed by accident.
  let armed = false;
  const clearBtn = host.querySelector('[data-clear]');
  clearBtn.addEventListener('click', async () => {
    const box = host.querySelector('[data-confirm]');
    if (!armed) {
      armed = true;
      box.hidden = false;
      clearBtn.textContent = 'Tap again to clear everything';
      setTimeout(() => {
        armed = false; box.hidden = true;
        clearBtn.innerHTML = icon('trash', 16) + ' Clear everything';
      }, 5000);
      return;
    }
    await store.clearEverything();
    toast('Everything cleared');
    router.go('/');
  });
}
