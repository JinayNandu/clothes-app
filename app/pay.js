// ============================================================================
// DEVI Collections — payment options and the UPI QR.
//
// THIS SITE TAKES NO MONEY. A UPI QR carries the shop's id, the exact amount
// and the order code; the customer scans it with whatever app they already
// use, and money goes from their bank to the shop's. No gateway, no
// per-transaction fee, no settlement delay, no card details anywhere near this
// code.
//
// ⚠️ WHAT IT CANNOT DO is know whether the payment happened. UPI sends no
// callback to a static page. So `paid` is a note somebody makes, never a fact
// this app observed, and the shop's own UPI app stays the source of truth.
//
// ⚠️ There is deliberately no `upi://` deep-link BUTTON. It does nothing at
// all on a desktop, and on a phone it hands off to an app that may not be
// installed — so it looks broken more often than it works. A QR works from any
// device with a camera and needs no handoff.
// ============================================================================

import { CDN, loadScript } from './config.js';
import { esc } from './ui.js';
import { icon } from './icons.js';
import * as D from './domain.js';

// ---------------------------------------------------------------------------
// PAYMENT OPTIONS
//
// ⚠️ A disabled option KEEPS ITS REASON ON IT and is never hidden. A hidden
// option reads as a shop that does not take cards; a disabled one that says
// why reads as a shop still setting up. Same instinct as kirana showing a full
// delivery slot rather than removing it.
// ---------------------------------------------------------------------------
export function payOptions(shop, selected) {
  const gw = D.gatewayState(shop.gateway);
  const cod = shop.shipping.codAvailable;

  const opt = (id, name, why, { on = true, badge = '' } = {}) => `
    <label class="pay-opt${selected === id ? ' on' : ''}${on ? '' : ' off'}">
      <input type="radio" name="pay" value="${esc(id)}"
        ${selected === id ? 'checked' : ''} ${on ? '' : 'disabled'}>
      <span>
        <span class="pay-name">${esc(name)}
          ${badge ? `<span class="pill pill-test">${esc(badge)}</span>` : ''}</span>
        <span class="pay-why">${esc(why)}</span>
      </span>
    </label>`;

  return [
    opt('upi', 'UPI', shop.upi.demo
      ? 'Scan a QR with any UPI app. This site shows a DEMO id — see the note below.'
      : 'Scan a QR with GPay, PhonePe, Paytm or your bank app.'),

    opt('card', 'Credit or debit card', gw.why,
        { on: gw.on, badge: gw.test ? 'Test mode' : '' }),

    opt('netbanking', 'Net banking', gw.why, { on: gw.on }),

    cod ? opt('cod', 'Cash on delivery',
      shop.shipping.codFee
        ? `Pay the courier. ${D.rupees(shop.shipping.codFee)} extra.`
        : 'Pay the courier when the parcel arrives.')
      : '',
  ].join('');
}

// ---------------------------------------------------------------------------
// THE DEMO STRIP
//
// Somebody looking at a QR should not have to understand UPI handles to feel
// safe about it, so this says it in words.
// ---------------------------------------------------------------------------
export function demoStrip(upi) {
  if (!upi.demo) return '';
  return `<div class="notice notice-warn">
    ${icon('warn', 18)}
    <div><b>This QR cannot take money.</b> The id
      <code>${esc(upi.vpa)}</code> ends in <code>@example</code>, which is not a
      real UPI handle — no payment app can resolve a payee, so money physically
      cannot move. The flow is real; only the payee is not.</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// THE QR
// ---------------------------------------------------------------------------
export async function drawQR(el, shop, order) {
  if (!shop.upi.vpa) {
    el.innerHTML = `<p class="t-micro dim">No UPI id is set up yet.
      Please use one of the ways below to reach us.</p>`;
    return;
  }

  const payload = D.upiPayload(shop.upi, order.grand, order.code);

  try {
    await loadScript(CDN.qrcode);
  } catch {
    // ⚠️ Visible, never a spinner. A blocked CDN behind a corporate proxy is
    // the most likely failure here and it must not look like the app hanging.
    el.innerHTML = `<p class="t-micro" style="color:var(--alert-ink)">
      The QR library did not load — it may be blocked on this network.
      You can still pay to <b>${esc(shop.upi.vpa)}</b> for
      <b>${D.rupees(order.grand)}</b>, quoting ${esc(order.code)}.</p>`;
    return;
  }

  el.innerHTML = '';
  const box = document.createElement('div');
  el.appendChild(box);

  // ⚠️ Black on white in every theme, via --art-ink / --art-paper, which are
  // declared identically in all three palette blocks. A QR themed to the page
  // loses the contrast a scanner needs; declaring those as non-varying tokens
  // is the honest way to say "not themed" rather than hardcoding white here.
  const cs = getComputedStyle(document.documentElement);
  /* global QRCode */
  new QRCode(box, {
    text: payload,
    width: 176,
    height: 176,
    colorDark: cs.getPropertyValue('--art-ink').trim(),
    colorLight: cs.getPropertyValue('--art-paper').trim(),
    correctLevel: QRCode.CorrectLevel.M,
  });
}
