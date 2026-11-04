// ============================================================================
// Vastra Apparel — entry point for the STORE page, owner.html.
//
// The shop's app.js has a twin here rather than a branch, because the two are
// different pages with different links: .../clothes-app/ for customers and
// .../clothes-app/store/ for whoever runs the shop. Nothing in app.js knows
// this file exists, and routes.pl fails if the shop ever imports a store
// module or links to this page.
//
// SHARED: the data layer (store.js), the router, the pure modules and the
// styles — so an order placed in the shop is the order this page lists, and
// the store looks like the same business. NOT SHARED: the route table, the
// screens, the chrome.
// ============================================================================

import * as store from './store.js';
import * as router from './router.js';
import { $, esc, emptyState, favicon } from './ui.js';
import { logo, seal } from './brand.js';
import { OWNER_ROUTES } from './domain.js';

// Registers the 'admin' screen at module scope.
import './pages/admin.js';

// The store's own not-found. The shop's points at "Shop all", which is the
// wrong way out of here.
router.registerScreen('notfound', async (host) => {
  host.innerHTML = emptyState(seal(64),
    'There is no such page in the store.',
    'The link may be mistyped. Everything the store does is in the tabs on '
    + 'the overview.',
    'Back to the overview', '#/');
});

async function boot() {
  try {
    await store.ready();
  } catch (e) {
    $('#main').innerHTML =
      `<div class="notice notice-bad" style="margin:var(--s6) 0">
        <div><b>The catalogue did not load.</b><br>
        ${esc(String(e.message || e))}</div></div>`;
    return;
  }

  const shop = await store.catalog.shop();
  $('#owner-logo').innerHTML = logo('sm');
  document.title = `Store — ${shop.brand.name}`;
  drawBar();

  if (store.shared()) {
    try {
      if (!(await store.staff.isStaff())) await lock();
    } catch (e) {
      $('#main').innerHTML =
        `<div class="notice notice-bad" style="margin:var(--s6) 0">
          <div><b>The store could not reach its server.</b><br>
          ${esc(String(e.message || e))}</div></div>`;
      return;
    }
  }
  await router.start(OWNER_ROUTES);
}

// ⚠️ THE BAR SAYS WHICH LOCK THIS IS. With no database there is no server to
// check a code, so there is no code, and the page says so; honesty.pl keeps
// that sentence here for as long as one-browser mode exists.
function drawBar() {
  const bar = $('#owner-bar');
  bar.innerHTML = store.shared()
    ? '<b>Locked</b> — this page opens only with the store code, which the '
      + 'server checks. Orders arrive here from every phone as they are placed.'
    : '<b>Not locked yet</b> — anyone with this link sees only the orders placed '
      + 'in their own browser, never anybody else\'s. When orders move to a server, '
      + 'this page will ask for the store code before it shows any.';
  bar.hidden = false;
}

/**
 * The store code, asked for once per browser.
 *
 * ⚠️ claim_staff() on the server decides; this form only carries what was
 * typed. Nothing here can tell a right code from a wrong one, and nothing
 * should: a page that could is a page anybody can read the answer out of.
 */
function lock() {
  const box = $('#lock');
  box.innerHTML = `
    <section class="panel lock">
      <h1 class="t-h1">Store code</h1>
      <p class="t-micro dim" style="margin-top:var(--s2)">This page shows every
        customer's name, phone number and address, so it opens only with the
        store code. The shop's server checks it, not this page, and this
        browser stays let in afterwards.</p>
      <form class="lock-form" data-lock novalidate>
        <div class="field">
          <label for="lock-code">Code</label>
          <input id="lock-code" name="code" type="password" autocomplete="off"
                 autocapitalize="none" spellcheck="false" maxlength="24">
        </div>
        <button type="submit" class="btn btn-primary">Open the store</button>
        <p class="t-micro lock-msg" data-msg role="status" aria-live="polite"></p>
      </form>
    </section>`;
  box.hidden = false;
  const form = box.querySelector('[data-lock]');
  const input = box.querySelector('#lock-code');
  const msg = box.querySelector('[data-msg]');
  const btn = form.querySelector('button');
  input.focus();

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = input.value.trim().toLowerCase();
      if (!code) { msg.textContent = 'Type the store code first.'; return; }
      btn.disabled = true;
      msg.textContent = 'Checking…';
      try {
        if (await store.staff.claim(code)) {
          box.hidden = true;
          box.innerHTML = '';
          resolve();
          return;
        }
        msg.textContent = 'That is not the store code.';
        input.select();
      } catch (err) {
        msg.textContent = /TOO_MANY_TRIES/.test(String(err.message))
          ? 'Too many tries from this browser. Wait an hour, then try again.'
          : 'The store could not reach its server: ' + String(err.message || err);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

favicon();
boot();
