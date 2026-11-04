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

/** The brand line, split on its first full stop so a two-sentence tagline
 *  stacks the way a hero wants and a one-sentence one still renders whole.
 *  Escaped, because it comes out of a file the owner edits. */
function tagline(shop) {
  const t = String((shop.brand && shop.brand.tagline) || '').trim();
  if (!t) return esc(shop.brand && shop.brand.name || '');
  const m = t.match(/^(.+?[.!?])\s+(.+)$/);
  return m ? `${esc(m[1])}<br>${esc(m[2])}` : esc(t);
}

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
      <div class="t-eyebrow">Direct from the floor that makes it</div>
      <!-- ⚠️ The headline is shop.brand.tagline, split on its first full
           stop, NOT two hardcoded lines. The owner has not chosen a name or a
           line yet; when they do it is a JSON edit, and a headline that can
           only be changed by editing JavaScript is a headline that stays
           wrong. The split is defensive: a one-sentence tagline renders as
           one line rather than losing half of itself. -->
      <h1 class="t-hero">${tagline(shop)}</h1>
      <p class="t-tagline">Shirts, kurtis and dresses, graded S to XXL on the
        same blocks we grade for export. No distributor, no retailer margin —
        the price here is what the garment costs to make and send.</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#/shop">Shop everything</a>
        <a class="btn btn-secondary" href="#/new">What is new</a>
      </div>
      <p class="t-micro dim" style="margin-top:var(--s2)">
        ${icon('truck', 14)} ${esc(D.shippingLine(shop))} &nbsp;·&nbsp;
        ${esc(D.returnsLine(shop))}</p>
    </div>
    <div class="hero-art">${heroArt(undefined, shop.hero && shop.hero.main)}</div>
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
            <!-- Styles, not subcategories: a category may have none, and "0 edits"
                 under a full category reads as broken. -->
            <small>${counts[c.id] || 0}
              ${(counts[c.id] || 0) === 1 ? "style" : "styles"}</small>
          </div>
        </a>`).join('')}
    </div>
  </section>

  ${rail('r-best', 'Bestsellers', best, shop, wishIds, '#/best')}
  ${rail('r-new', 'New Arrivals', fresh, shop, wishIds, '#/new')}

  <!-- WHY THE PRICE IS THE PRICE
       DEVI had a "Featured collection" panel here pointing at a category.
       This shop has three products, so a curated edit would be two of them
       and a link — merchandising furniture with nothing behind it. The
       manufacturer-direct story is the one thing this shop can say that the
       marketplaces cannot, so it gets the slot until there is a real edit
       to put in it. ⚠️ The category link that used to be here pointed at
       bedcovers-quilts, which no longer exists: routes.pl proves a #/ link
       matches a ROUTE, not that the category behind it is real. -->
  <section class="sec">
    <div class="panel" style="background:var(--sunk);border-color:var(--edge)">
      <div class="two-col" style="gap:var(--s6);align-items:center">
        <div>
          <div class="t-eyebrow" style="color:var(--gold-ink)">Why it costs less</div>
          <h2 class="t-h1" style="margin:var(--s2) 0 var(--s3)">The same floor,
            without the middle</h2>
          <p class="t-long" style="color:var(--ink-soft);max-width:48ch">
            We have cut and stitched for other labels for seventeen years. The
            cloth, the pattern masters and the finishing line were always ours;
            only the name on the collar was not. Buying here skips the
            distributor and the shop, and what is left is the garment and the
            courier.</p>
          <div style="margin-top:var(--s5);display:flex;gap:var(--s3);flex-wrap:wrap">
            <a class="btn btn-primary" href="#/shop">See what we make</a>
            <a class="btn btn-secondary" href="#/about">How we got here</a>
          </div>
        </div>
        <div class="hero-art" style="height:340px;min-height:0">
          ${heroArt('vastra-direct', shop.hero && shop.hero.direct)}
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
        <h2 class="t-h2">New batches, before your size goes</h2>
        <p class="t-micro dim" style="max-width:46ch">
          We cut in batches and a size runs out before the batch does. Leave your
          address and we will tell you when something lands or comes back in
          your size — a few times a season, never more.</p>
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
        ${handoffBlock(`Please add me to the Vastra Apparel list: ${email}`,
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
