// ============================================================================
// DEVI Collections — the handoff.
//
// This is how an order actually reaches DEVI, and it is not a stand-in for a
// real mechanism: a WhatsApp handoff is how an Indian home-decor business of
// this size already takes orders. It works today, with no backend, no gateway
// fee and no settlement delay.
//
// ONE MECHANISM, THREE USES — placing an order, the contact page, and the
// newsletter box. A contact form that POSTs nowhere is a lie; a wa.me / tel: /
// mailto: block with a copy button is the same affordance and actually works.
//
// ⚠️ tools/honesty.pl fails on any <form> with an action attribute, because
// that is the shape a fake submission takes.
// ============================================================================

import { esc, toast } from './ui.js';
import { icon } from './icons.js';
import * as D from './domain.js';

/**
 * The three channels, as buttons. Any channel with no number or address
 * configured is simply absent — a disabled "WhatsApp" button on a shop with no
 * WhatsApp number tells the customer nothing useful.
 */
export function handoffBlock(text, shop, { subject = 'Order' } = {}) {
  const wa = D.whatsappLink(text, shop);
  const tel = D.telLink(shop);
  const mail = D.mailtoLink(subject, text, shop);

  const buttons = [
    wa ? `<a class="btn btn-primary" href="${esc(wa)}" target="_blank"
            rel="noopener" data-sent="whatsapp">${icon('chat', 16)} Send on WhatsApp</a>` : '',
    tel ? `<a class="btn btn-secondary" href="${esc(tel)}"
            data-sent="phone">${icon('phone', 16)} Call ${esc(shop.contact.phone)}</a>` : '',
    mail ? `<a class="btn btn-secondary" href="${esc(mail)}"
            data-sent="email">${icon('mail', 16)} Email us</a>` : '',
    `<button type="button" class="btn btn-secondary" data-copy
       data-sent="copy">${icon('copy', 16)} Copy the text</button>`,
  ].filter(Boolean).join('');

  // When nothing is configured, say so rather than showing a lone Copy button
  // with no explanation of where to put what was copied.
  const none = !wa && !tel && !mail;

  return `<div class="handoff">${buttons}</div>
    ${none ? `<p class="t-micro" style="color:var(--alert-ink);margin-top:var(--s3)">
      No phone number or email is configured yet, so there is nowhere for this
      to go. Whoever set this site up needs to fill in <code>contact</code> in
      <code>app/data/shop.json</code>.</p>` : ''}
    <textarea class="sr-only" data-copytext aria-hidden="true">${esc(text)}</textarea>`;
}

/**
 * Wires the block. `onSent(via)` fires when the customer actually hands the
 * order over — that, and only that, is what moves an order from draft to sent.
 */
export function wireHandoff(root, onSent) {
  root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-sent]');
    if (!el) return;

    if (el.hasAttribute('data-copy')) {
      const ta = root.querySelector('[data-copytext]');
      const text = ta ? ta.value : '';
      try {
        await navigator.clipboard.writeText(text);
        toast('Order text copied');
      } catch {
        // Clipboard access needs a secure context and a user gesture, and it
        // is refused outright in some embedded frames. Falling back to a
        // visible, selected textarea is better than a silent failure.
        if (ta) {
          ta.classList.remove('sr-only');
          ta.removeAttribute('aria-hidden');
          ta.style.width = '100%';
          ta.style.minHeight = '180px';
          ta.select();
          toast('Select and copy the text above');
        }
      }
    }

    if (onSent) onSent(el.dataset.sent);
  });
}
