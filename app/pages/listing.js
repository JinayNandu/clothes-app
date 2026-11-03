// ============================================================================
// Listing — ONE screen serving shop-all, a category, a subcategory, new
// arrivals, bestsellers and search. They differ only in which products they
// start from and what the heading says; six near-identical screens would be
// six places to fix every grid bug.
//
// Filters live in the query AFTER the hash (#/shop?sort=price-asc&min=500) so
// a filtered view is shareable and the browser back button undoes a filter.
// ============================================================================

import * as store from '../store.js';
import * as router from '../router.js';
import { esc, h1, crumbs, emptyState } from '../ui.js';
import { productGrid, field } from '../components.js';
import { seal, ornament } from '../brand.js';
import { icon } from '../icons.js';
import * as D from '../domain.js';

router.registerScreen('listing', async (host, r) => {
  const [all, cats, shop, wishIds] = await Promise.all([
    store.catalog.all(), store.catalog.categories(),
    store.catalog.shop(), store.wishlist.ids(),
  ]);

  const ctx = resolve(r, all, cats, shop);
  const bands = D.priceBands(all);

  // Price band -> min/max. A band id is shorter and more readable in a URL
  // than a pair of numbers, and it survives a price edit.
  const bandId = r.query.band || '';
  const band = bands.find((b) => b.id === bandId);
  const filtered = D.filterProducts(ctx.base, {
    min: band ? band.min : null,
    max: band && band.max != null ? band.max : null,
  });

  const sort = r.query.sort || ctx.defaultSort;
  const list = D.sortProducts(filtered, sort);

  host.innerHTML = `
    ${ctx.crumbs ? crumbs(ctx.crumbs) : ''}
    ${h1(ctx.title, ctx.eyebrow, ctx.sub)}
    ${ctx.base.length ? toolbar(list.length, sort, bands, bandId) : ''}
    ${list.length
      ? productGrid(list, shop, wishIds)
      : emptyState(seal(64), ctx.emptyHead, ctx.emptyBody,
                   ctx.emptyCta, ctx.emptyHref)}
    ${ctx.footNote || ''}`;

  wire(host, r);
});

// ---------------------------------------------------------------------------
// What this listing IS
// ---------------------------------------------------------------------------
function resolve(r, all, cats, shop) {
  const p = r.path;

  if (p === '/new') {
    return {
      base: all.filter((x) => D.isNew(x, shop)),
      title: 'New Arrivals', eyebrow: 'Just in',
      sub: `Everything added in the last ${shop.newDays} days.`,
      defaultSort: 'new',
      crumbs: [{ label: 'Home', href: '#/' }, { label: 'New Arrivals' }],
      emptyHead: 'Nothing new this month.',
      emptyBody: 'New pieces arrive every few weeks. The bestsellers are a good place to wait.',
      emptyCta: 'Browse bestsellers', emptyHref: '#/best',
    };
  }

  if (p === '/best') {
    return {
      base: all.filter((x) => (x.badges || []).includes('bestseller')),
      title: 'Bestsellers', eyebrow: 'Most loved',
      sub: 'The pieces that go out of stock first.',
      defaultSort: 'popularity',
      crumbs: [{ label: 'Home', href: '#/' }, { label: 'Bestsellers' }],
      emptyHead: 'No bestsellers marked yet.',
      emptyBody: 'Have a look at everything instead — it is not a long catalogue.',
      emptyCta: 'Shop all', emptyHref: '#/shop',
    };
  }

  if (p === '/search') {
    const q = r.query.q || '';
    const found = D.searchProducts(all, q, cats);
    return {
      base: found,
      title: q ? `Results for “${q}”` : 'Search',
      eyebrow: 'Search',
      sub: q ? null : 'Type in the box above to search by name, fabric or category.',
      defaultSort: 'popularity',
      crumbs: [{ label: 'Home', href: '#/' }, { label: 'Search' }],
      emptyHead: q ? `Nothing matched “${q}”.` : 'What are you looking for?',
      emptyBody: q
        ? 'Try a broader word — “dohar”, “brass”, “pouch” — or browse a category from the sidebar.'
        : 'Search by product name, by a fabric or craft, or by category.',
      emptyCta: 'Shop all', emptyHref: '#/shop',
      footNote: q && found.length ? suggestions(cats) : '',
    };
  }

  if (r.params.cat) {
    const c = cats.find((x) => x.slug === r.params.cat);
    if (!c) {
      return {
        base: [], title: 'Category not found', eyebrow: 'Shop',
        defaultSort: 'popularity',
        crumbs: [{ label: 'Home', href: '#/' }, { label: 'Shop', href: '#/shop' }],
        emptyHead: 'That category does not exist.',
        emptyBody: 'It may have been renamed. Everything we sell is on one page.',
        emptyCta: 'Shop all', emptyHref: '#/shop',
      };
    }
    const s = r.params.sub ? c.sub.find((x) => x.slug === r.params.sub) : null;
    return {
      base: all.filter((x) => x.cat === c.id && (!s || x.sub === s.id)),
      title: s ? s.name : c.name,
      eyebrow: s ? c.name : 'Category',
      sub: s ? null : c.blurb,
      defaultSort: 'popularity',
      crumbs: [
        { label: 'Home', href: '#/' },
        { label: 'Shop', href: '#/shop' },
        ...(s ? [{ label: c.name, href: `#/c/${c.slug}` }, { label: s.name }]
              : [{ label: c.name }]),
      ],
      emptyHead: 'This edit is being restocked.',
      emptyBody: 'We buy in small batches, so a sold-out piece stays out until the next one. New pieces arrive every few weeks.',
      emptyCta: 'See what is in stock', emptyHref: '#/shop',
    };
  }

  return {
    base: all,
    title: 'Shop All', eyebrow: 'Everything',
    sub: `All ${all.length} pieces, across ${cats.length} categories.`,
    defaultSort: 'popularity',
    crumbs: [{ label: 'Home', href: '#/' }, { label: 'Shop All' }],
    emptyHead: 'The catalogue is empty.',
    emptyBody: 'That should not happen. Please tell us — the contact page has the ways to reach us.',
    emptyCta: 'Contact us', emptyHref: '#/contact',
  };
}

const suggestions = (cats) => `
  <div style="margin-top:var(--s6)">${ornament()}
    <p class="t-micro dim" style="text-align:center;margin-top:var(--s4)">
      Looking for something else? ${cats.slice(0, 4)
        .map((c) => `<a href="#/c/${esc(c.slug)}" class="btn-ghost">${esc(c.name)}</a>`)
        .join(' · ')}
    </p>
  </div>`;

// ---------------------------------------------------------------------------
// TOOLBAR
// ---------------------------------------------------------------------------
function toolbar(n, sort, bands, bandId) {
  const chips = bands.map((b) => `
    <button type="button" class="chip${b.id === bandId ? ' on' : ''}"
      data-band="${esc(b.id)}">${esc(b.label)}</button>`).join('');
  const clear = bandId
    ? `<button type="button" class="chip" data-band="">${icon('close', 13)} Clear</button>`
    : '';

  return `<div class="toolbar">
    <span class="count">${n} ${n === 1 ? 'piece' : 'pieces'}</span>
    <span class="spacer"></span>
    ${field('sort', 'Sort by', { options: D.SORTS.map((s) => s.label),
      value: (D.SORTS.find((s) => s.id === sort) || {}).label || '' })}
  </div>
  <div class="filters">
    <span class="t-eyebrow">Price</span>${chips}${clear}
  </div>`;
}

// ---------------------------------------------------------------------------
// WIRING
// ---------------------------------------------------------------------------
function wire(host, r) {
  const sel = host.querySelector('[data-field="sort"] select');
  if (sel) {
    // The select renders labels; the URL carries ids.
    sel.addEventListener('change', () => {
      const s = D.SORTS.find((x) => x.label === sel.value);
      router.replace(r.path, { ...r.query, sort: s ? s.id : '' });
    });
  }
  for (const b of host.querySelectorAll('[data-band]')) {
    b.addEventListener('click', () => {
      router.replace(r.path, { ...r.query, band: b.dataset.band });
    });
  }
}
