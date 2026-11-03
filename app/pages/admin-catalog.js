// ============================================================================
// Admin — catalogue, inventory, categories and data.
//
// These four tabs all edit ONE thing: the overlay described in overlay.js, a
// set of field-level patches over the shipped catalogue. Nothing here writes a
// catalogue; it writes a diff against one.
//
// ⚠️ THE VALIDATION BELOW MIRRORS tools/data.pl ON PURPOSE. Every rule here
// is one data.pl also enforces, so a mistake is caught at the keystroke rather
// than three days later by a check script the owner is not running. Where the
// two could drift, data.pl is the authority: it also runs in CI and on an
// exported file, and validateProduct() exists to be the friendly early copy.
//
// ⚠️ NO IMAGE UPLOADS. An image field takes a PATH. localStorage is about
// 5 MB; four base64 JPEGs fill it, and after that every cart write fails --
// silently, because a quota error surfaces nowhere near the thing that broke.
// ============================================================================

import * as store from '../store.js';
import { esc, notice, toast, $, $$ } from '../ui.js';
import * as D from '../domain.js';
import * as O from '../overlay.js';

const DERIVED_BADGES = ['new', 'sale', 'low-stock', 'sold-out'];
const KINDS = ['goods', 'voucher'];
const SHIP_CLASSES = ['std', 'bulky'];

const num = (v) => (v === '' || v == null ? NaN : Number(v));
const isInt = (v) => Number.isInteger(v);
const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const href = (tab, q) => `#/admin/${tab}${q ? '?' + q : ''}`;

/** Which fields of this product the overlay is currently patching. */
const patchedFields = (ov, pid) => new Set(Object.keys((ov && ov.patch && ov.patch[pid]) || {}));

const patchMark = (set, name) => (set.has(name)
  ? `<button type="button" class="adm-revert" data-revert="${esc(name)}"
       title="Edited here. Click to go back to the shipped value.">edited ✕</button>`
  : '');

// ---------------------------------------------------------------------------
// CATALOGUE — list, or one product open in the editor.
// ---------------------------------------------------------------------------
export function renderCatalogue(ctx) {
  const { all, query } = ctx;
  const pid = query.p;
  if (pid) {
    const p = all.find((x) => x.id === pid);
    if (!p) {
      return notice('warn', `No product with id <code>${esc(pid)}</code>.
        <a href="${href('catalogue')}">Back to the list</a>.`);
    }
    return productEditor(p, ctx);
  }
  return productList(ctx);
}

function productList({ all, cats, shop, ov, query }) {
  const q = (query.q || '').toLowerCase();
  const list = q
    ? all.filter((p) => (p.name + ' ' + p.id + ' ' + (p.sub || p.cat))
        .toLowerCase().includes(q))
    : all;
  const retired = new Set((ov && ov.retired) || []);
  const added = new Set(((ov && ov.added) || []).map((p) => p.id));

  return `
  <div class="adm-bar">
    <input class="adm-search" type="search" id="adm-q" value="${esc(query.q || '')}"
      placeholder="Search ${all.length} products by name, id or subcategory">
    <button class="btn btn-sm btn-primary" data-act="new-product">Add a product</button>
  </div>

  ${retired.size ? notice('info', `${retired.size} product${retired.size === 1 ? ' is' : 's are'}
    retired and hidden from the shop. They still resolve by id, so carts,
    wishlists and past orders that reference them keep working.`) : ''}

  <div class="adm-table-wrap">
  <table class="adm-table">
    <thead><tr>
      <th>Product</th><th>Subcategory</th><th class="num">Price</th>
      <th class="num">MRP</th><th class="num">Stock</th><th>State</th><th></th>
    </tr></thead>
    <tbody>
    ${list.map((p) => {
    const edits = patchedFields(ov, p.id);
    return `<tr${retired.has(p.id) ? ' class="is-retired"' : ''}>
        <td><a href="${href('catalogue', 'p=' + encodeURIComponent(p.id))}">${esc(p.name)}</a>
          <div class="t-micro dim">${esc(p.id)}</div></td>
        <td class="t-micro">${esc(p.sub || '—')}</td>
        <td class="num">${D.rupees(p.price)}</td>
        <td class="num${p.mrp > p.price ? ' was' : ''}">${D.rupees(p.mrp)}</td>
        <td class="num">${p.kind === 'voucher' ? '—' : p.stock}</td>
        <td>
          ${added.has(p.id) ? '<span class="pill pill-sent">added here</span>' : ''}
          ${retired.has(p.id) ? '<span class="pill pill-bad">retired</span>' : ''}
          ${edits.size ? `<span class="pill pill-sent">${edits.size} edit${edits.size === 1 ? '' : 's'}</span>` : ''}
          ${D.derivedBadges(p, shop).map((b) => `<span class="pill pill-draft">${esc(b)}</span>`).join('')}
        </td>
        <td class="num"><a class="btn btn-sm btn-ghost"
          href="${href('catalogue', 'p=' + encodeURIComponent(p.id))}">Edit</a></td>
      </tr>`;
  }).join('')}
    </tbody>
  </table>
  ${list.length ? '' : '<p class="t-micro dim" style="padding:var(--s4)">Nothing matches that.</p>'}
  </div>`;
}

function productEditor(p, { cats, ov, all }) {
  const edits = patchedFields(ov, p.id);
  const isAdded = ((ov && ov.added) || []).some((x) => x.id === p.id);
  const isRetired = ((ov && ov.retired) || []).includes(p.id);
  // A category with NO subcategories is itself an option, with an empty
  // value: its products are filed on the category alone.
  const subs = cats.flatMap((c) => ((c.sub || []).length
    ? c.sub.map((s) => ({ id: s.id, cat: c.id, label: `${c.name} → ${s.name}` }))
    : [{ id: '', cat: c.id, label: c.name }]));

  return `
  <div class="adm-bar">
    <a class="btn btn-sm btn-ghost" href="${href('catalogue')}">← All products</a>
    <span class="t-micro dim">${esc(p.id)}${isAdded ? ' · created in this browser' : ''}</span>
  </div>

  <form class="adm-form" id="adm-product" data-pid="${esc(p.id)}" novalidate>
    <div class="two-col">
      <div>
        <section class="panel">
          <h2 class="t-h3">What it is</h2>
          ${row('name', 'Name', edits, `<input name="name" type="text" value="${esc(p.name)}" required>`)}
          ${row('slug', 'Slug (the bit in the URL)', edits,
    `<input name="slug" type="text" value="${esc(p.slug)}" pattern="[a-z0-9-]+" required>`)}
          ${row('shortDesc', 'Short description', edits,
    `<textarea name="shortDesc" rows="2">${esc(p.shortDesc)}</textarea>`)}
          ${row('desc', 'Full description', edits,
    `<textarea name="desc" rows="6">${esc(p.desc)}</textarea>`)}
        </section>

        <section class="panel" style="margin-top:var(--s4)">
          <h2 class="t-h3">Specifications</h2>
          <div id="adm-specs">
            ${(p.specs || []).map((s, i) => specRow(s, i)).join('')}
          </div>
          <button type="button" class="btn btn-sm btn-secondary"
            data-act="add-spec" style="margin-top:var(--s3)">Add a row</button>
          ${patchMark(edits, 'specs')}
        </section>

        <section class="panel" style="margin-top:var(--s4)">
          <h2 class="t-h3">Variants</h2>
          <p class="t-micro dim">
            Only the <b>size</b> axis may carry a price delta — two priced axes
            make the effective price a grid and this editor a spreadsheet.
            A colour delta is refused on save.</p>
          ${notice('info', `Editing any variant replaces the <b>whole</b>
            variants value in the patch, so a colour added to this product in a
            later <code>catalog.json</code> would not flow through. Scalar
            fields do not have that problem.`)}
          <div id="adm-variants" style="margin-top:var(--s3)">
            ${variantEditor(p.variants || {})}
          </div>
          ${patchMark(edits, 'variants')}
        </section>
      </div>

      <aside>
        <section class="panel">
          <h2 class="t-h3">Money and stock</h2>
          ${row('price', 'Price (₹)', edits,
    `<input name="price" type="number" inputmode="numeric" step="1" min="0" value="${p.price}" required>`)}
          ${row('mrp', 'MRP (₹)', edits,
    `<input name="mrp" type="number" inputmode="numeric" step="1" min="0" value="${p.mrp}" required>`)}
          <p class="t-micro dim">Whole rupees only. Price must not exceed MRP;
            the discount percentage is computed from the two and never stored.</p>
          ${row('stock', 'Stock', edits,
    `<input name="stock" type="number" inputmode="numeric" step="1" min="0"
       value="${p.stock == null ? '' : p.stock}" ${p.kind === 'voucher' ? 'disabled' : ''}>`)}
          ${row('popularity', 'Popularity (sorts the rails)', edits,
    `<input name="popularity" type="number" inputmode="numeric" step="1" min="0" value="${p.popularity}">`)}
        </section>

        <section class="panel" style="margin-top:var(--s4)">
          <h2 class="t-h3">Filing</h2>
          ${row('sub', 'Filed under', edits, `<select name="sub">
            ${subs.map((s) => `<option value="${esc(s.id)}"${
              // Two leaf categories both carry the empty value, so matching
              // on the value alone would select both.
              (s.id ? s.id === p.sub : (!p.sub && s.cat === p.cat))
                ? ' selected' : ''}
              data-cat="${esc(s.cat)}">${esc(s.label)}</option>`).join('')}
          </select>`)}
          ${row('kind', 'Kind', edits, `<select name="kind">
            ${KINDS.map((k) => `<option${k === p.kind ? ' selected' : ''}>${k}</option>`).join('')}
          </select>`)}
          ${row('shipClass', 'Shipping class', edits, `<select name="shipClass">
            ${SHIP_CLASSES.map((k) => `<option${k === p.shipClass ? ' selected' : ''}>${k}</option>`).join('')}
          </select>`)}
          ${row('addedOn', 'Added on', edits,
    `<input name="addedOn" type="date" value="${esc(p.addedOn)}">`)}
          ${row('badges', 'Badges', edits,
    `<input name="badges" type="text" value="${esc((p.badges || []).join(', '))}">`)}
          <p class="t-micro dim">Comma separated, and only what a human chose.
            <code>${DERIVED_BADGES.join('</code>, <code>')}</code> are derived
            from the data every time the page renders — storing one makes a
            product permanently new, or permanently on sale.</p>
          ${row('tags', 'Search tags', edits,
    `<input name="tags" type="text" value="${esc((p.tags || []).join(', '))}">`)}
          ${row('img', 'Image paths', edits,
    `<input name="img" type="text" value="${esc((p.img || []).join(', '))}"
       placeholder="img/products/thing-1.jpg, , img/products/thing-3.jpg">`)}
          <p class="t-micro dim">
            A <b>path</b>, never an upload — this is localStorage, and four
            photographs would fill it. One per view, comma separated; leave a
            slot empty to keep the generated artwork for that view.</p>
        </section>
      </aside>
    </div>

    <div class="adm-save">
      <button class="btn btn-primary" type="submit">Save changes</button>
      <button class="btn btn-secondary" type="button" data-act="revert-all"
        ${edits.size || isAdded ? '' : 'disabled'}>Revert this product</button>
      <button class="btn btn-ghost" type="button"
        data-act="${isRetired ? 'unretire' : 'retire'}">
        ${isRetired ? 'Put back on the shop' : 'Retire from the shop'}</button>
      <div class="adm-errs" id="adm-errs" hidden></div>
    </div>
  </form>`;
}

const row = (name, label, edits, control) => `
  <div class="adm-field" data-field="${esc(name)}">
    <label>${esc(label)} ${patchMark(edits, name)}</label>
    ${control}
    <div class="adm-err" hidden></div>
  </div>`;

const specRow = (s, i) => `<div class="adm-spec" data-i="${i}">
  <input class="adm-spec-k" type="text" value="${esc(s.k)}" placeholder="Material">
  <input class="adm-spec-v" type="text" value="${esc(s.v)}" placeholder="100% cotton">
  <button type="button" class="btn btn-sm btn-ghost" data-act="rm-spec">✕</button>
</div>`;

function variantEditor(v) {
  const size = v.size || [];
  const colour = v.colour || [];
  return `
  ${size.length ? `<h3 class="t-micro">Size — the one axis that may change the price</h3>
  <div class="adm-vars">
    ${size.map((s) => `<div class="adm-var" data-axis="size" data-id="${esc(s.id)}">
      <input class="adm-var-label" type="text" value="${esc(s.label)}">
      <label class="t-micro dim">delta ₹
        <input class="adm-var-delta" type="number" step="1" value="${s.delta || 0}"></label>
    </div>`).join('')}
  </div>` : '<p class="t-micro dim">No size axis.</p>'}

  ${colour.length ? `<h3 class="t-micro" style="margin-top:var(--s4)">Colour — label and swatch only</h3>
  <div class="adm-vars">
    ${colour.map((c) => `<div class="adm-var" data-axis="colour" data-id="${esc(c.id)}">
      <span class="adm-swatch" style="background:${esc(c.swatch)}"></span>
      <input class="adm-var-label" type="text" value="${esc(c.label)}">
      <input class="adm-var-swatch" type="text" value="${esc(c.swatch)}"
        pattern="#[0-9A-Fa-f]{6}" size="8">
    </div>`).join('')}
  </div>` : ''}`;
}

/** Read the form back into a product object. */
function readProduct(form, p) {
  const g = (n) => { const el = form.elements[n]; return el ? el.value : undefined; };
  const specs = $$('.adm-spec', form).map((r) => ({
    k: $('.adm-spec-k', r).value.trim(), v: $('.adm-spec-v', r).value.trim(),
  })).filter((s) => s.k || s.v);

  const variants = {};
  for (const el of $$('.adm-var', form)) {
    const axis = el.dataset.axis;
    const src = ((p.variants || {})[axis] || []).find((x) => x.id === el.dataset.id) || {};
    const item = { ...src, id: el.dataset.id, label: $('.adm-var-label', el).value.trim() };
    if (axis === 'size') item.delta = Math.round(num($('.adm-var-delta', el).value) || 0);
    const sw = $('.adm-var-swatch', el);
    if (sw) item.swatch = sw.value.trim();
    (variants[axis] = variants[axis] || []).push(item);
  }

  const subSel = form.elements.sub;
  const opt = subSel.options[subSel.selectedIndex];
  const cat = opt.dataset.cat;
  // null, not ''. null is the overlay's UNSET: moving a product into a
  // category with no subcategories has to make the key DISAPPEAR, and an
  // empty string would export as `"sub": ""` and fail data.pl.
  const sub = opt.value || null;

  const out = {
    name: g('name').trim(), slug: g('slug').trim(),
    shortDesc: g('shortDesc').trim(), desc: g('desc').trim(),
    price: Math.round(num(g('price'))), mrp: Math.round(num(g('mrp'))),
    popularity: Math.round(num(g('popularity')) || 0),
    sub, cat, kind: g('kind'), shipClass: g('shipClass'),
    addedOn: g('addedOn'),
    badges: splitList(g('badges')), tags: splitList(g('tags')),
    specs, variants,
  };

  // A voucher has no stock. Leaving a 0 behind would make data.pl fail on a
  // shape rule that has nothing to do with what the owner just changed.
  if (out.kind !== 'voucher') out.stock = Math.round(num(g('stock')) || 0);

  const imgs = splitList(g('img'));
  if (imgs.length) out.img = imgs;
  return out;
}

/** The friendly early copy of tools/data.pl. See the header. */
function validateProduct(next, p, all) {
  const errs = [];
  const bad = (field, msg) => errs.push({ field, msg });

  if (!next.name) bad('name', 'A product needs a name.');
  if (!/^[a-z0-9-]+$/.test(next.slug)) {
    bad('slug', 'Lower case letters, digits and hyphens only — it goes in the URL.');
  }
  if (all.some((x) => x.slug === next.slug && x.id !== p.id)) {
    bad('slug', 'Another product already uses that slug.');
  }
  for (const f of ['price', 'mrp', 'popularity']) {
    if (!isInt(next[f]) || next[f] < 0) bad(f, 'Whole numbers only, zero or more.');
  }
  if (isInt(next.price) && isInt(next.mrp) && next.price > next.mrp) {
    bad('price', 'Price cannot be above MRP. To show no saving, set them equal.');
  }
  if (next.kind !== 'voucher' && (!isInt(next.stock) || next.stock < 0)) {
    bad('stock', 'Whole numbers only, zero or more.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.addedOn || '')) bad('addedOn', 'Needs a date.');
  for (const b of next.badges) {
    if (DERIVED_BADGES.includes(b)) {
      bad('badges', `"${b}" is derived from the data and must not be stored. `
        + 'It is computed on every render.');
    }
  }
  for (const c of next.variants.colour || []) {
    if (c.delta) bad('variants', 'Only the size axis may carry a price delta.');
    if (c.swatch && !/^#[0-9A-Fa-f]{6}$/.test(c.swatch)) {
      bad('variants', `"${c.swatch}" is not a six-digit hex colour.`);
    }
  }
  return errs;
}

// ---------------------------------------------------------------------------
// INVENTORY — one number per product, and nothing else in the way.
// ---------------------------------------------------------------------------
export function renderInventory({ all, shop, ov }) {
  const goods = all.filter((p) => p.kind !== 'voucher');
  const low = goods.filter((p) => p.stock <= shop.lowStockAt);
  const retired = new Set((ov && ov.retired) || []);

  return `
  <div class="adm-bar">
    <span class="t-micro dim">${goods.length} stocked products ·
      ${low.length} at or below the low-stock mark of ${shop.lowStockAt} ·
      vouchers are not stocked and are not listed</span>
    <button class="btn btn-sm btn-primary" data-act="save-stock">Save all changes</button>
  </div>

  <form class="adm-stock" id="adm-stock">
    <div class="adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>Product</th><th>Subcategory</th>
        <th class="num">In stock</th><th>State</th></tr></thead>
      <tbody>
      ${goods.map((p) => `<tr${retired.has(p.id) ? ' class="is-retired"' : ''}>
        <td><a href="${href('catalogue', 'p=' + encodeURIComponent(p.id))}">${esc(p.name)}</a></td>
        <td class="t-micro">${esc(p.sub || '—')}</td>
        <td class="num"><input class="adm-stock-n" type="number" step="1" min="0"
          data-pid="${esc(p.id)}" data-was="${p.stock}" value="${p.stock}"></td>
        <td>${p.stock === 0 ? '<span class="pill pill-bad">sold out</span>'
    : p.stock <= shop.lowStockAt ? '<span class="pill pill-sent">low</span>' : ''}
          ${retired.has(p.id) ? '<span class="pill pill-bad">retired</span>' : ''}</td>
      </tr>`).join('')}
      </tbody>
    </table>
    </div>
  </form>`;
}

// ---------------------------------------------------------------------------
// CATEGORIES
//
// ⚠️ A category SLUG is in every link to that category and in anything anyone
// has bookmarked, and a category ID is in every product record that points at
// it. The id is therefore not editable here at all; the slug is, and renaming
// one only changes a URL. That split is why product rows never need rewriting.
// ---------------------------------------------------------------------------
export function renderCategories({ cats, all, ov }) {
  const counts = {};
  for (const p of all) {
    counts[p.cat] = (counts[p.cat] || 0) + 1;
    if (p.sub) counts[p.sub] = (counts[p.sub] || 0) + 1;
  }
  const patched = (ov && ov.catPatch) || {};

  return `
  ${notice('info', `A category <b>id</b> is what every product record points
    at, so it is fixed here. The <b>slug</b> is only the URL and can be
    changed — anything already linking to the old one stops resolving, which
    is the normal cost of renaming a URL.`)}

  <form id="adm-cats">
  ${cats.slice().sort((a, b) => a.order - b.order).map((c) => `
    <section class="panel adm-cat" data-cid="${esc(c.id)}" style="margin-top:var(--s4)">
      <div class="adm-cat-head">
        <h2 class="t-h3">${esc(c.name)}</h2>
        <span class="t-micro dim">${esc(c.id)} · ${counts[c.id] || 0} products
          ${patched[c.id] ? ' · <span class="pill pill-sent">edited</span>' : ''}</span>
      </div>
      <div class="adm-cat-grid">
        <div class="adm-field"><label>Name</label>
          <input class="c-name" type="text" value="${esc(c.name)}"></div>
        <div class="adm-field"><label>Slug</label>
          <input class="c-slug" type="text" value="${esc(c.slug)}" pattern="[a-z0-9-]+"></div>
        <div class="adm-field"><label>Order</label>
          <input class="c-order" type="number" step="1" min="1" value="${c.order}"></div>
        <div class="adm-field span2"><label>Blurb</label>
          <input class="c-blurb" type="text" value="${esc(c.blurb || '')}"></div>
      </div>

      <h3 class="t-micro" style="margin-top:var(--s4)">Subcategories</h3>
      ${(c.sub || []).length ? '' : `<p class="t-micro dim">None — this
        category holds its ${counts[c.id] || 0} products directly, and they
        carry no subcategory at all.</p>`}
      <div class="adm-subs">
        ${(c.sub || []).slice().sort((a, b) => a.order - b.order).map((s) => `
          <div class="adm-sub" data-sid="${esc(s.id)}">
            <input class="s-name" type="text" value="${esc(s.name)}">
            <input class="s-slug" type="text" value="${esc(s.slug)}" pattern="[a-z0-9-]+">
            <input class="s-order" type="number" step="1" min="1" value="${s.order}">
            <span class="t-micro dim">${counts[s.id] || 0}</span>
          </div>`).join('')}
      </div>
    </section>`).join('')}
  </form>

  <div class="adm-save">
    <button class="btn btn-primary" type="button" data-act="save-cats">Save categories</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// DATA — review, export, and the honest limits of both.
// ---------------------------------------------------------------------------
export async function renderData(ctx) {
  const { ov, state } = ctx;
  const edits = O.countEdits(ov);
  const [catJSON, catsJSON, canon] = await Promise.all([
    store.catalog.exportCatalog(), store.catalog.exportCategories(),
    store.catalog.canonSelfCheck(),
  ]);

  let review = '';
  if (state === 'stale') {
    const [{ agreed, conflicts, gone }, shipped] = await Promise.all([
      store.catalog.reconcile(), store.catalog.shipped(),
    ]);
    review = `
    <section class="panel">
      <h2 class="t-h3">Review — the catalogue moved under these edits</h2>
      <p class="t-micro dim" style="margin-top:var(--s2);max-width:66ch">
        These patches were written against <code>rev ${esc(String(ov.rev))}</code>
        and the catalogue now loaded is <code>rev ${esc(String(shipped.rev))}</code>.
        Until this is settled they are <b>not applied</b> and the shop shows the
        shipped file — the safe direction, because a price set against a
        catalogue that has since changed is an opinion about a product that may
        no longer be the same product.</p>

      ${agreed.length ? `<p class="t-micro" style="margin-top:var(--s4)">
        <b>${agreed.length}</b> of them say exactly what the new catalogue
        already says. Those can go.</p>` : ''}

      ${gone.length ? notice('warn', `<b>${gone.length} patch${gone.length === 1 ? '' : 'es'}
        point at products that no longer exist</b>
        (${gone.map((g) => `<code>${esc(g.pid)}</code>`).join(', ')}).
        Keeping them would resurrect a retired product at a price nobody
        chose, so they are dropped with the rest.`) : ''}

      ${conflicts.length ? `
      <div class="adm-table-wrap" style="margin-top:var(--s4)">
      <table class="adm-table">
        <thead><tr><th>Product</th><th>Field</th><th>Yours</th><th>Now shipped</th></tr></thead>
        <tbody>${conflicts.map((c) => `<tr>
          <td>${esc(c.name || c.pid)}</td><td class="t-micro">${esc(c.field)}</td>
          <td class="num">${esc(short(c.mine))}</td>
          <td class="num">${esc(short(c.theirs))}</td></tr>`).join('')}
        </tbody></table></div>`
    : `<p class="t-micro" style="margin-top:var(--s3)">
        Nothing actually conflicts.</p>`}

      <div class="adm-save">
        <button class="btn btn-primary" type="button" data-act="drop-agreed">
          Drop what the catalogue already agrees with</button>
        <button class="btn btn-secondary" type="button" data-act="keep-mine">
          Keep all ${edits} against the new catalogue</button>
        <button class="btn btn-ghost" type="button" data-act="clear-overlay">
          Throw all of them away</button>
      </div>
    </section>`;
  }

  return `
  ${review}

  <section class="panel" style="margin-top:var(--s4)">
    <h2 class="t-h3">Export</h2>
    <p class="t-micro dim" style="margin-top:var(--s2);max-width:66ch">
      ${edits ? `${edits} edit${edits === 1 ? '' : 's'} in this browser.`
    : 'Nothing is edited, so this is the shipped catalogue re-encoded — which '
      + 'is still a useful thing to check.'}
      Paste each into the matching file in <code>app/data/</code>, then run
      <code>perl tools/check.pl</code>. <code>data.pl</code> takes a path, so
      you can validate the file <i>before</i> it replaces anything.</p>

    ${notice('info', `Exporting bumps <code>rev</code>. That is what lets these
      patches retire themselves: once the file is in place the overlay sees a
      catalogue that already says everything it was holding, finds no conflict,
      and clears in one click.`)}

    ${canon.map((c) => (c.comparable
    ? (c.ok
      ? `<p class="t-micro"><b>✓ ${esc(c.name)}</b> — this page re-encodes the
           shipped file byte for byte, so its export will diff cleanly against
           what <code>tools/canon.pl</code> produces.</p>`
      : `<p class="t-micro"><b>✕ ${esc(c.name)}</b> — re-encoding does
           <b>not</b> reproduce the shipped bytes; they first differ at
           character ${c.firstDiff.at}. Exporting now would produce a
           reformatting diff. Run <code>perl tools/canon.pl --write</code>.</p>`)
    : `<p class="t-micro dim">${esc(c.name)} — cannot be compared here: this
         build has the data inlined and no file to fetch. Served over http it
         checks itself.</p>`)).join('')}

    ${exportBox('catalog.json', catJSON)}
    ${exportBox('categories.json', catsJSON)}
  </section>

  ${edits && state === 'current' ? `
  <section class="panel" style="margin-top:var(--s4)">
    <h2 class="t-h3">Start again</h2>
    <p class="t-micro dim" style="margin-top:var(--s2);max-width:66ch">
      Throws away all ${edits} edits and goes back to the shipped catalogue.
      There is no copy of them anywhere else.</p>
    <div class="adm-save">
      <button class="btn btn-ghost" type="button" data-act="clear-overlay">
        Discard ${edits} edit${edits === 1 ? '' : 's'}</button>
    </div>
  </section>` : ''}`;
}

const short = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s == null ? '' : (s.length > 40 ? s.slice(0, 37) + '…' : s);
};

const exportBox = (name, text) => `
  <div class="adm-export" data-file="${esc(name)}">
    <div class="adm-bar">
      <code>app/data/${esc(name)}</code>
      <span>
        <span class="t-micro dim">${text.length.toLocaleString('en-IN')} bytes</span>
        <button class="btn btn-sm btn-secondary" type="button" data-act="copy">Copy</button>
        <button class="btn btn-sm btn-ghost" type="button" data-act="download">Download</button>
      </span>
    </div>
    <textarea class="adm-json" readonly rows="8" spellcheck="false">${esc(text)}</textarea>
  </div>`;

// ---------------------------------------------------------------------------
// WIRING
// ---------------------------------------------------------------------------
export function wireCatalogTab(tab, host, ctx, repaint) {
  if (tab === 'catalogue') wireCatalogue(host, ctx, repaint);
  else if (tab === 'inventory') wireInventory(host, repaint);
  else if (tab === 'categories') wireCategories(host, ctx, repaint);
  else if (tab === 'data') wireData(host, repaint);
}

function wireCatalogue(host, ctx, repaint) {
  const search = $('#adm-q', host);
  if (search) {
    search.addEventListener('input', () => {
      // Filtering is a view change, so it replaces rather than pushes: back
      // should leave the admin, not walk every keystroke.
      const q = search.value.trim();
      const url = '#/admin/catalogue' + (q ? '?q=' + encodeURIComponent(q) : '');
      try {
        if (location.hash !== url) history.replaceState(null, '', url);
      } catch {
        // ⚠️ Opaque origin — a file:// page, which is exactly where the
        // single-file build runs. router.js wraps this for the same reason.
        // Not falling back to a hash assignment here on purpose: that fires
        // hashchange, repaints the screen and takes the focus out of this
        // box mid-word. The filter below is what the owner actually wants;
        // only the shareable URL is lost, and only on file://.
      }
      filterRows(host, q);
    });
  }

  const newBtn = $('[data-act="new-product"]', host);
  if (newBtn) newBtn.addEventListener('click', () => createProduct(ctx));

  const form = $('#adm-product', host);
  if (!form) return;
  const pid = form.dataset.pid;
  const p = ctx.all.find((x) => x.id === pid);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = readProduct(form, p);
    const errs = validateProduct(next, p, ctx.all);
    showErrors(form, errs);
    if (errs.length) return;
    await store.catalog.patch(pid, next);
    toast('Saved. Only the fields that differ from the shipped file are kept.');
    repaint();
  });

  for (const b of $$('[data-revert]', form)) {
    b.addEventListener('click', async () => {
      await store.catalog.revertField(pid, b.dataset.revert);
      toast(`${b.dataset.revert} is back to the shipped value.`);
      repaint();
    });
  }

  on(form, 'add-spec', () => {
    $('#adm-specs', form).insertAdjacentHTML('beforeend',
      specRow({ k: '', v: '' }, $$('.adm-spec', form).length));
    wireSpecRemovals(form);
  });
  wireSpecRemovals(form);

  on(form, 'revert-all', async () => {
    await store.catalog.revertProduct(pid);
    toast('Back to the shipped product.');
    location.hash = '#/admin/catalogue';
  });
  on(form, 'retire', async () => {
    await store.catalog.retire(pid);
    toast('Retired. It is off the shop but still resolves by id.');
    repaint();
  });
  on(form, 'unretire', async () => {
    await store.catalog.unretire(pid); toast('Back on the shop.'); repaint();
  });
}

const on = (root, act, fn) => {
  const el = $(`[data-act="${act}"]`, root);
  if (el) el.addEventListener('click', fn);
};

function wireSpecRemovals(form) {
  for (const b of $$('[data-act="rm-spec"]', form)) {
    b.onclick = () => b.closest('.adm-spec').remove();
  }
}

function filterRows(host, q) {
  const needle = q.toLowerCase();
  for (const tr of $$('.adm-table tbody tr', host)) {
    tr.hidden = needle ? !tr.textContent.toLowerCase().includes(needle) : false;
  }
}

function showErrors(form, errs) {
  for (const f of $$('.adm-field', form)) {
    const box = $('.adm-err', f);
    if (box) { box.hidden = true; box.textContent = ''; }
    f.classList.remove('has-err');
  }
  const summary = $('#adm-errs', form);
  summary.hidden = !errs.length;
  summary.innerHTML = errs.map((e) => `<div>${esc(e.msg)}</div>`).join('');
  for (const e of errs) {
    const f = $(`.adm-field[data-field="${e.field}"]`, form);
    if (!f) continue;
    f.classList.add('has-err');
    const box = $('.adm-err', f);
    if (box) { box.hidden = false; box.textContent = e.msg; }
  }
  if (errs.length) summary.scrollIntoView({ block: 'nearest' });
}

/** A new product starts from a real shape, not an empty object. */
async function createProduct(ctx) {
  const firstCat = ctx.cats[0];
  const firstSub = (firstCat.sub || [])[0];
  // A unique slug from what is already there, rather than a timestamp: no
  // clock read outside domain.js, and the result is the same every time for
  // the same catalogue, which makes it reproducible.
  const taken = new Set(ctx.all.map((p) => p.slug));
  let slug = 'untitled-product', n = 1;
  while (taken.has(slug)) { n += 1; slug = `untitled-product-${n}`; }

  const created = await store.catalog.addProduct({
    name: 'Untitled product', slug,
    shortDesc: '', desc: '', price: 0, mrp: 0, stock: 0, popularity: 50,
    cat: firstCat.id, ...(firstSub ? { sub: firstSub.id } : {}),
    kind: 'goods', shipClass: 'std', addedOn: D.istDate(),
    badges: [], tags: [], specs: [], variants: {},
  });
  toast('Created. It is live in this browser until you export.');
  location.hash = '#/admin/catalogue?p=' + encodeURIComponent(created.id);
}

function wireInventory(host, repaint) {
  on(host, 'save-stock', async () => {
    const changed = $$('.adm-stock-n', host)
      .filter((i) => String(i.value) !== String(i.dataset.was));
    if (!changed.length) { toast('Nothing changed.'); return; }
    const bad = changed.find((i) => !isInt(num(i.value)) || num(i.value) < 0);
    if (bad) { toast('Stock must be a whole number, zero or more.'); bad.focus(); return; }
    for (const i of changed) {
      await store.catalog.patch(i.dataset.pid, { stock: Math.round(num(i.value)) });
    }
    toast(`Updated ${changed.length} product${changed.length === 1 ? '' : 's'}.`);
    repaint();
  });
}

function wireCategories(host, ctx, repaint) {
  on(host, 'save-cats', async () => {
    let n = 0;
    for (const sec of $$('.adm-cat', host)) {
      const cid = sec.dataset.cid;
      const ship = ctx.cats.find((c) => c.id === cid);
      const sub = $$('.adm-sub', sec).map((el) => {
        const src = (ship.sub || []).find((s) => s.id === el.dataset.sid) || {};
        return {
          ...src, id: el.dataset.sid,
          name: $('.s-name', el).value.trim(),
          slug: $('.s-slug', el).value.trim(),
          order: Math.round(num($('.s-order', el).value) || 1),
        };
      });
      const next = {
        name: $('.c-name', sec).value.trim(),
        slug: $('.c-slug', sec).value.trim(),
        blurb: $('.c-blurb', sec).value.trim(),
        order: Math.round(num($('.c-order', sec).value) || 1),
        sub,
      };
      const slugs = [next.slug, ...sub.map((s) => s.slug)];
      if (slugs.some((s) => !/^[a-z0-9-]+$/.test(s))) {
        toast(`${next.name}: a slug may hold only lower case letters, digits and hyphens.`);
        return;
      }
      await store.catalog.patchCategory(cid, next);
      n += 1;
    }
    toast(`Saved ${n} categor${n === 1 ? 'y' : 'ies'}.`);
    repaint();
  });
}

function wireData(host, repaint) {
  for (const box of $$('.adm-export', host)) {
    const ta = $('.adm-json', box);
    const name = box.dataset.file;

    $('[data-act="copy"]', box).addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ta.value);
        toast(`${name} copied.`);
      } catch {
        // Refused in some embedded viewers. Selecting the text still lets the
        // viewer copy it by hand, which beats a button that does nothing.
        ta.focus(); ta.select();
        toast('Could not reach the clipboard — the text is selected, copy it.');
      }
    });

    $('[data-act="download"]', box).addEventListener('click', () => {
      // ⚠️ A sandboxed viewer blocks a page-initiated download with no error
      // of any kind, so this can do nothing at all and never say so. The Copy
      // button is the one that always works; this is the convenience.
      const url = URL.createObjectURL(new Blob([ta.value], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  on(host, 'drop-agreed', async () => {
    await store.catalog.dropAgreed();
    toast('Dropped the patches the catalogue already agreed with.');
    repaint();
  });
  on(host, 'keep-mine', async () => {
    await store.catalog.keepMine();
    toast('Kept, and re-stamped against the catalogue now loaded.');
    repaint();
  });
  on(host, 'clear-overlay', async () => {
    await store.catalog.clearOverlay();
    toast('Cleared. The shop is showing the shipped catalogue.');
    repaint();
  });
}
