// ============================================================================
// Sign in -- an email, then a six-digit code. The box, wherever it is offered:
// the account page, checkout, and an order's page after a guest's first order.
//
// ⚠️ NEVER A WALL, NEVER A PASSWORD. Nothing in the shop waits on this box: a
// guest browses, bags and orders exactly as before. honesty.pl fails if
// placing an order ever stops making its own guest session, if a password
// field turns up anywhere in the shop, or if sign-in becomes a screen of its
// own that could stand in front of it. Supabase checks the code, on the
// server; this box only carries it there.
//
// ⚠️ KEEP IT OUT OF ANY REGION THAT IS REPAINTED UNDER IT. A page that redraws
// on 'orders' must hold the box outside what it redraws, or a status update
// arriving mid-code wipes the digits being typed. CLAUDE.md: "An input must
// never sit inside the region its own handler repaints."
// ============================================================================

import * as store from './store.js';
import { esc } from './ui.js';
import { OTP_LEN } from './config.js';
import * as D from './domain.js';

// Ids must be unique in the DOCUMENT, and a screen's markup stays in it while
// the screen is hidden: the account page's box and checkout's can both exist.
let made = 0;

/** The box, closed: an email and a button. `lead` is a sentence of HTML. */
export function signInBox(lead) {
  const n = (made += 1);
  return `<div class="signin" data-signin>
    ${lead ? `<p class="signin-lead">${lead}</p>` : ''}
    <div class="signin-step" data-si-email-step>
      <div class="field">
        <label for="si-email-${n}">Email</label>
        <input id="si-email-${n}" type="email" inputmode="email" autocomplete="email"
          placeholder="you@example.com" data-si-email>
      </div>
      <button type="button" class="btn btn-primary" data-si-send>Send me a code</button>
    </div>
    <div class="signin-step" data-si-code-step hidden>
      <p class="signin-sent" data-si-sent></p>
      <div class="field">
        <label for="si-code-${n}">The ${OTP_LEN}-digit code</label>
        <input id="si-code-${n}" type="text" inputmode="numeric" autocomplete="one-time-code"
          maxlength="${OTP_LEN}" pattern="[0-9]*" class="signin-code" data-si-code>
      </div>
      <button type="button" class="btn btn-primary" data-si-verify>Sign in</button>
      <div class="signin-links">
        <button type="button" class="btn-ghost" data-si-again>Send a new code</button>
        <button type="button" class="btn-ghost" data-si-change>Use a different email</button>
      </div>
    </div>
    <p class="signin-msg" data-si-msg role="status" aria-live="polite"></p>
  </div>`;
}

/**
 * Wire one box. `onDone(who)` runs once the code is accepted: who is
 * { email, guest: false, moved }, `moved` being the guest orders that came
 * across into an account that already existed.
 */
export function wireSignIn(root, onDone) {
  const box = root.matches('[data-signin]') ? root : root.querySelector('[data-signin]');
  if (!box || !store.account) return;
  const $ = (s) => box.querySelector(s);
  const emailIn = $('[data-si-email]');
  const codeIn = $('[data-si-code]');
  const again = $('[data-si-again]');
  const msg = $('[data-si-msg]');
  let sent = null;              // { mode, email } once a code is on its way
  let busy = false;
  let timer = null;

  const say = (text, bad = false) => {
    msg.textContent = text;
    msg.classList.toggle('bad', bad);
  };
  const setBusy = (on) => {
    busy = on;
    for (const b of box.querySelectorAll('[data-si-send], [data-si-verify]')) b.disabled = on;
  };

  // Supabase sends one code a minute to an address; the button says so
  // rather than failing on a second tap.
  function cooldown(seconds) {
    clearInterval(timer);
    let left = seconds;
    const tick = () => {
      if (!box.isConnected) { clearInterval(timer); return; }
      again.disabled = left > 0;
      again.textContent = left > 0 ? `Send a new code (${left}s)` : 'Send a new code';
      left -= 1;
      if (left < -1) clearInterval(timer);
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  async function send() {
    if (busy) return;
    const email = emailIn.value.trim();
    if (!D.validEmail(email)) {
      say('That does not look like an email address.', true);
      emailIn.focus();
      return;
    }
    setBusy(true);
    say('Sending your code…');
    try {
      sent = await store.account.sendCode(email);
      $('[data-si-email-step]').hidden = true;
      $('[data-si-code-step]').hidden = false;
      $('[data-si-sent]').innerHTML = `We have sent a ${OTP_LEN}-digit code to
        <b>${esc(sent.email)}</b>. It can take a minute; if nothing comes, look in spam.`;
      say('');
      codeIn.value = '';
      codeIn.focus();
      cooldown(60);
    } catch (e) {
      say(whyNot(e), true);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (busy || !sent) return;
    const code = codeIn.value.replace(/\D/g, '');
    if (code.length !== OTP_LEN) {
      say(`The code is ${OTP_LEN} digits.`, true);
      codeIn.focus();
      return;
    }
    setBusy(true);
    say('Checking…');
    try {
      const who = await store.account.verifyCode(sent.email, code, sent.mode);
      clearInterval(timer);
      say('');
      onDone(who);
    } catch (e) {
      say(whyNot(e), true);
      codeIn.select();
    } finally {
      setBusy(false);
    }
  }

  $('[data-si-send]').addEventListener('click', send);
  emailIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  $('[data-si-verify]').addEventListener('click', verify);
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') verify(); });
  // Digits only, and the last one sends it: a code pasted from the email, or
  // filled in by the phone's own one-time-code suggestion, signs in at once.
  codeIn.addEventListener('input', () => {
    const clean = codeIn.value.replace(/\D/g, '').slice(0, OTP_LEN);
    if (clean !== codeIn.value) codeIn.value = clean;
    if (clean.length === OTP_LEN) verify();
  });
  again.addEventListener('click', () => { if (!again.disabled) send(); });
  $('[data-si-change]').addEventListener('click', () => {
    clearInterval(timer);
    sent = null;
    $('[data-si-code-step]').hidden = true;
    $('[data-si-email-step]').hidden = false;
    say('');
    emailIn.focus();
  });
}

/** What went wrong, in words, and what to do about it. */
function whyNot(e) {
  const m = String((e && (e.message || e.msg)) || e);
  if (/expired|invalid/i.test(m) && /token|otp|code/i.test(m)) {
    return 'That code is wrong or has expired. Check it, or ask for a new one.';
  }
  if (/only request this after|rate limit|too many/i.test(m)) {
    return 'Too many tries just now. Wait a minute, then ask for a new code.';
  }
  if (/signups? not allowed|not found/i.test(m)) {
    return 'We could not find that account. Check the email for a typo.';
  }
  if (/invalid format|unable to validate email/i.test(m)) {
    return 'That does not look like an email address.';
  }
  if (/fetch|network|load failed|BLOCKED/i.test(m)) {
    return 'We could not reach the shop just now. Please try again.';
  }
  return 'That did not work: ' + m;
}
