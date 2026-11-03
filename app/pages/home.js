// ============================================================================
// Home.
//
// Built late on purpose: by this point it composes components that already
// exist — the card, the rail, the price block — rather than inventing them a
// second time and leaving two versions to drift.
//
// ⚠️ NO CAROUSEL. Auto-rotating heroes measurably lose clicks, and on a static
// site every slide nobody sees is dead weight in the document. One hero, one
// message; the rails are what carry merchandising breadth.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, toast } from '../ui.js';
import { rail } from '../components.js';
import { heroArt, categoryArt } from '../art.js';
import { logo, ornament } from '../brand.js';
import { handoffBlock, wireHandoff } from '../handoff.js';
import { icon } from '../icons.js';
import * as D from '../domain.js';

router.registerScreen('home', async (host) => {
  const [cats, shop, wishIds, best, fresh, offers, under, counts] =
    await Promise.all([
      store.catalog.categories(), store.catalog.shop(), store.wishlist.ids(),
      store.catalog.bestsellers(8), store.catalog.newArrivals(8),
      store.catalog.onOffer(8), store.catalog.under(999, 8),
      store.catalog.counts(),
    ]);

  host.innerHTML = `
  <!-- HERO -->
  <section class="hero">
    <div class="hero-copy">
      <div class="t-eyebrow">The Festive Edit &middot; AW26</div>
      <h1 class="t-hero">Thoughtfully Curated.<br>Beautifully Yours.</h1>
      <p class="t-tagline">Bedsheets, bedcovers and quilts, dohars and table
        runners — block-printed and hand-stitched in small batches across
        Rajasthan, Bengal and Telangana.</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#/shop">Shop the collection</a>
        <a class="btn btn-secondary" href="#/new">What is new</a>
      </div>
      <p class="t-micro dim" style="margin-top:var(--s2)">
        ${icon('truck', 14)} Complimentary shipping above
        ${D.rupees(shop.shipping.freeOver)} &nbsp;·&nbsp;
        Dispatched in ${esc(shop.shipping.shipsIn)}</p>
    </div>
    <div class="hero-art">${heroArt()}</div>
  </section>

  <div style="margin:var(--s7) 0">${ornament()}</div>

  <!-- FEATURED CATEGORIES -->
  <section class="sec">
    <div class="sec-head">
      <h2 class="t-h2">Shop by category</h2>
      <a class="btn-ghost" href="#/shop">View all</a>
    </div>
    <div class="tiles">
      ${cats.map((c) => `
        <a class="tile" href="#/c/${esc(c.slug)}">
          <div class="tile-art">${categoryArt(c)}</div>
          <div class="tile-grad"></div>
          <div class="tile-name">${esc(c.name)}
            <!-- Pieces, not subcategories: two of the four categories have
                 none, and "0 edits" under a full category reads as broken. -->
            <small>${counts[c.id] || 0}
              ${(counts[c.id] || 0) === 1 ? 'piece' : 'pieces'}</small>
          </div>
        </a>`).join('')}
    </div>
  </section>

  ${rail('r-best', 'Bestsellers', best, shop, wishIds, '#/best')}
  ${rail('r-new', 'New Arrivals', fresh, shop, wishIds, '#/new')}

  <!-- FEATURED COLLECTION -->
  <section class="sec">
    <div class="panel" style="background:var(--sunk);border-color:var(--edge)">
      <div class="two-col" style="gap:var(--s6);align-items:center">
        <div>
          <div class="t-eyebrow" style="color:var(--gold-ink)">Featured collection</div>
          <h2 class="t-h1" style="margin:var(--s2) 0 var(--s3)">The Block Print Room</h2>
          <p class="t-long" style="color:var(--ink-soft);max-width:48ch">
            Everything in this edit was printed by hand with carved teak blocks
            in Bagru and Sanganer — each one placed by eye, which is why no two
            repeats land quite the same way. Bed covers, sheets, dohars and the
            table runner that matches them.</p>
          <div style="margin-top:var(--s5);display:flex;gap:var(--s3);flex-wrap:wrap">
            <a class="btn btn-primary" href="#/c/bedcovers-quilts">
              Explore the room</a>
            <a class="btn btn-secondary" href="#/about">How we buy</a>
          </div>
        </div>
        <div class="hero-art" style="height:340px;min-height:0">
          ${heroArt('devi-collection-blockprint')}
        </div>
      </div>
    </div>
  </section>

  ${rail('r-offers', 'Special Offers', offers, shop, wishIds, '#/shop?sort=discount')}
  ${rail('r-under', 'Under ₹999', under, shop, wishIds, '#/shop?band=u999')}

  <!-- NEWSLETTER -->
  <section class="sec">
    <div class="news">
      <div class="news-inner">
        <span style="color:var(--gold)">${logo('sm')}</span>
        <h2 class="t-h2">New batches, before they sell out</h2>
        <p class="t-micro dim" style="max-width:46ch">
          We buy in small lots, so the good pieces go quickly. Leave your
          address and we will tell you when a batch lands — a few times a
          season, never more.</p>
        <div class="news-form">
          <input type="email" data-news placeholder="you@example.com"
            aria-label="Email address" autocomplete="email">
          <button type="button" class="btn btn-primary" data-subscribe>Notify me</button>
        </div>
        <div data-newsout style="width:100%;max-width:420px"></div>
        <p class="t-micro dim">
          ${icon('shield', 13)} No server, no mailing list software, no tracking.
          This opens your own mail app with the message ready to send.</p>
      </div>
    </div>
  </section>`;

  // -------------------------------------------------------------------------
  // THE NEWSLETTER IS A HANDOFF, NOT A FORM.
  // A subscribe box that POSTs nowhere and then says "Thanks for subscribing!"
  // is the same lie as a fake order confirmation, in a smaller font. This
  // opens a real message the customer can actually send.
  // -------------------------------------------------------------------------
  host.querySelector('[data-subscribe]').addEventListener('click', () => {
    const input = host.querySelector('[data-news]');
    const email = input.value.trim();
    if (!D.validEmail(email)) { toast('Please enter a valid email address'); input.focus(); return; }

    const out = host.querySelector('[data-newsout]');
    out.innerHTML = `
      <div class="notice notice-info" style="text-align:left;margin-top:var(--s2)">
        ${icon('info', 18)}
        <div>Nothing has been sent yet &mdash; there is no mailing list behind
        this site. Use one of these and we will add <b>${esc(email)}</b> by
        hand.</div>
      </div>
      <div style="margin-top:var(--s3)" data-handoff>
        ${handoffBlock(`Please add me to the DEVI Collections list: ${email}`,
          shop, { subject: 'Mailing list' })}
      </div>`;
    wireHandoff(out.querySelector('[data-handoff]'), null);
  });

  // Rails scroll with the wheel on a trackpad but need buttons on a mouse.
  for (const w of host.querySelectorAll('.rail-wrap')) {
    const sc = w.querySelector('.rail-scroll');
    if (!sc) continue;
    const nav = document.createElement('div');
    nav.className = 'rail-nav';
    nav.style.cssText = 'position:absolute;top:-52px;right:0';
    nav.innerHTML = `<button type="button" data-dir="-1" aria-label="Scroll left">
        ${icon('left', 16)}</button>
      <button type="button" data-dir="1" aria-label="Scroll right">
        ${icon('chevron', 16)}</button>`;
    w.appendChild(nav);
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dir]');
      if (!b) return;
      sc.scrollBy({ left: Number(b.dataset.dir) * sc.clientWidth * 0.8,
                    behavior: 'smooth' });
    });
  }
});
