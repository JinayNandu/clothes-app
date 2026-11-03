// ============================================================================
// About, Contact and the four policy pages — all six rendered from
// data/pages.json, so adding a paragraph to the returns policy is a JSON edit
// and not a code change.
//
// ⚠️ A `fromShop` block interpolates a value straight out of shop.json. That
// is what stops the Shipping page and the cart's arithmetic disagreeing:
// data.pl fails on a path that does not resolve, which turns "the policy says
// ₹99 but we charge ₹149" from an embarrassment into a check failure.
//
// ⚠️ The contact form is NOT a form. There is no server to POST to, so a
// submit button here would be a lie. It is a handoff block — the same one the
// order confirmation uses — which actually works.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, h1, notice } from '../ui.js';
import { handoffBlock, wireHandoff } from '../handoff.js';
import { field } from '../components.js';
import { ornament } from '../brand.js';
import { icon } from '../icons.js';
import * as D from '../domain.js';

router.registerScreen('info', async (host, r) => {
  const pages = await store.catalog.pages();
  const shop = await store.catalog.shop();
  const bulky = (await store.catalog.all())
    .filter((p) => p.shipClass === 'bulky').map((p) => p.name);
  const key = r.params.page;
  const page = pages[key];

  if (!page) { host.innerHTML = h1('Not found', 'Page'); return; }

  host.innerHTML = `
    ${h1(page.title, page.eyebrow)}
    <div class="prose">
      ${page.blocks.map((b) => block(b, shop, key, bulky)).join('')}
    </div>
    <div style="margin-top:var(--s7)">${ornament()}</div>
    <p class="t-micro dim" style="text-align:center;margin-top:var(--s4)">
      Last updated ${esc(D.fmtDate(page.updated))}</p>`;

  const h = host.querySelector('[data-handoff]');
  if (h) wireHandoff(h, null);
});

function block(b, shop, pageKey, bulky = []) {
  switch (b.t) {
    case 'h2': return `<h2>${esc(b.v)}</h2>`;
    case 'p':  return `<p>${esc(b.v)}</p>`;
    case 'ul': return `<ul>${b.v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;

    case 'fromShop': {
      // Resolve a dotted path into shop.json. data.pl has already proved it
      // resolves, so a miss here means the JSON changed without the check
      // being run.
      let cur = shop;
      for (const seg of b.v.split('.')) cur = cur ? cur[seg] : undefined;
      return cur == null ? '' : `<p><strong>${esc(cur)}</strong></p>`;
    }

    case 'shippingTable': {
      const s = shop.shipping;
      return `<ul>
        <li><strong>${D.rupees(s.fee)}</strong> flat, anywhere in India.</li>
        <li><strong>Free</strong> on orders above ${D.rupees(s.freeOver)},
            measured on the value of the goods before any discount code.</li>
        <li><strong>${D.rupees(s.bulkySurcharge)}</strong> extra per oversized
            item. ${bulky.length
              ? `At present that means ${esc(D.listOf(bulky))}.`
              : 'Nothing we currently sell is oversized, so this does not '
                + 'apply to anything in the catalogue today.'}</li>
        ${s.codAvailable ? `<li>Cash on delivery is available${s.codFee
          ? `, ${D.rupees(s.codFee)} extra` : ' at no extra charge'}.</li>` : ''}
      </ul>`;
    }

    case 'contactCard': {
      const c = shop.contact;
      const any = c.phone || c.email || c.whatsapp;
      if (!any) {
        return notice('warn', '<b>No contact details are configured yet.</b> '
          + 'Whoever set this site up needs to fill in <code>contact</code> in '
          + '<code>app/data/shop.json</code>. Until then there is genuinely no '
          + 'way to reach anyone from this page, and pretending otherwise with '
          + 'a form that goes nowhere would be worse.');
      }
      return `<div class="contact-grid" style="margin:var(--s5) 0">
        <div class="panel">
          <h2 class="t-h3" style="margin-bottom:var(--s3)">Reach us</h2>
          <div class="totals">
            ${c.phone ? `<div class="total-row muted">
              <span>${icon('phone', 15)} Phone</span>
              <span class="user-text">${esc(c.phone)}</span></div>` : ''}
            ${c.whatsapp ? `<div class="total-row muted">
              <span>${icon('chat', 15)} WhatsApp</span>
              <span class="user-text">${esc(c.whatsapp)}</span></div>` : ''}
            ${c.email ? `<div class="total-row muted">
              <span>${icon('mail', 15)} Email</span>
              <span class="user-text">${esc(c.email)}</span></div>` : ''}
            <div class="total-row muted"><span>Hours</span>
              <span>${esc(c.hours)}</span></div>
            ${c.addr ? `<div class="total-row muted"><span>Address</span>
              <span class="user-text" style="text-align:right">${esc(c.addr)}<br>
              ${esc(c.city)}, ${esc(c.state)} ${esc(c.pin)}</span></div>` : ''}
            ${c.gstin ? `<div class="total-row muted"><span>GSTIN</span>
              <span class="user-text">${esc(c.gstin)}</span></div>` : ''}
          </div>
        </div>
        <div class="panel">
          <h2 class="t-h3" style="margin-bottom:var(--s3)">Write to us</h2>
          <p class="t-micro dim" style="margin-bottom:var(--s4)">
            Type your message and it will open in WhatsApp or your mail app,
            already filled in. We do not run a server, so nothing is submitted
            from this page.</p>
          ${field('msg', 'Your message', { rows: 4, span: true,
            placeholder: 'What can we help with?' })}
          <div style="margin-top:var(--s4)" data-handoff>
            ${handoffBlock('Hello DEVI Collections,\n\n', shop,
              { subject: 'Enquiry' })}
          </div>
        </div>
      </div>`;
    }

    default: return '';
  }
}
