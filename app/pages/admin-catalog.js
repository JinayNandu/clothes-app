// ============================================================================
// The store's catalogue: PRODUCTS -- the list, a quick price change, one
// product open in the editor, a new one -- and INVENTORY, the stock of every
// colour in every size. (8 November 2026, the owner: "they should have an
// option to add any new products with images etc, / update price of existing
// products / update inventory etc too".)
//
// EVERY CHANGE GOES THROUGH store.catalogAdmin: on the database, functions
// that check the store's session first and check every field again
// (db/schema.sql save_product, set_price, set_stock, set_hidden), so a
// customer sees it on their next page; in one browser, the overlay of
// backend-local.js. The checks below are the owner's convenience -- a
// mistake named at the field -- and the server's are the rules.
//
// ⚠️ STOCK IS CHANGED BY THE DIFFERENCE. Each box remembers the number it was
// drawn with, and what is sent is [that, what was typed]: an order placed
// while the page was open has already taken its pieces, and writing the old
// number back would hand them out twice.
//
// ⚠️ NOTHING TYPED IS LOST TO A REDRAW. The store page redraws when an order
// arrives; busy() tells it not to while a product is open or the stock has
// changes, and the editor keeps its work in `ed`, not in the page.
//
// PHOTOGRAPHS are made 4:5, at most 1024 by 1280, and JPEG in the browser
// (shrinkPhoto), then uploaded; the product keeps their addresses. One
// uploaded and then left unsaved stays in storage, unused -- it costs a few
// hundred kilobytes and harms nothing.
// ============================================================================

import * as store from '../store.js';
import { esc, notice, toast, askFirst, $, $$ } from '../ui.js';
import * as D from '../domain.js';
import { icon } from '../icons.js';
import { art } from '../art.js';

const LIMIT = { photos: 12, colours: 12, sizes: 12, specs: 20 };

/** Lower case, digits and hyphens: how an id or a link is spelled. */
const slugify = (s, max = 56) => String(s || '').toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');

// A new colour's dot before anybody picks one: the theme's own neutral, read
// from tokens.css at the moment it is needed -- art.pl allows no colour
// written into a module, and a swatch is product data, chosen by a person.
const neutral = () => (getComputedStyle(document.documentElement)
  .getPropertyValue('--edge-2') || '').trim().toUpperCase();

const whole = (v) => (/^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN);
const signed = (v) => (/^-?\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN);

/** The subcategories as choices, "Women → Dresses", valued cat|sub. */
const filing = (cats) => cats.slice().sort((a, b) => a.order - b.order).flatMap((c) => ((c.sub || []).length
  ? c.sub.slice().sort((a, b) => a.order - b.order).map((s) => ({ value: `${c.id}|${s.id}`, label: `${c.name} → ${s.name}` }))
  : [{ value: `${c.id}|`, label: c.name }]));

const filedAs = (p, cats) => {
  const c = cats.find((x) => x.id === p.cat);
  const s = c && (c.sub || []).find((x) => x.id === p.sub);
  return c ? (s ? `${c.name} → ${s.name}` : c.name) : (p.cat || '—');
};

/** The server's refusals, in the owner's words. */
function said(e) {
  const m = String((e && e.message) || e);
  if (/NOT_STAFF/.test(m)) return 'This browser is no longer let into the store. Reload the page and type the store code.';
  if (/NOT_SET_UP/.test(m)) return 'The products are not in the database yet: run db/SETUP.md step 11 first.';
  if (/NO_UPLOADS_HERE/.test(m)) return 'Photographs can be uploaded once the shop has its database.';
  if (/SLUG_TAKEN/.test(m)) return 'Another product already has the link this name makes. Change the name a little.';
  if (/NEEDS_A_PHOTO/.test(m)) return 'A product in the shop needs at least one photograph. Add one, or untick "Show it in the shop".';
  if (/BAD_MRP/.test(m)) return 'The MRP must be a whole number, at least the price.';
  if (/BAD_PRICE/.test(m)) return 'The price must be a whole number of rupees, and no size may come to nothing.';
  if (/BAD_PHOTOS/.test(m)) return 'One of the photographs is not this shop\'s own. Remove it and upload it again.';
  if (/BAD_COLOUR/.test(m)) return 'A colour needs a name and a colour, and only sizes may change the price.';
  if (/BAD_SIZE/.test(m)) return 'A size needs a short name, and its extra must be whole rupees.';
  if (/BAD_STOCK/.test(m)) return 'Stock must be whole numbers, 0 or more.';
  if (/Payload too large|exceeded the maximum|413/.test(m)) return 'That photograph is too large to upload.';
  if (/mime|not supported|invalid_mime/i.test(m)) return 'That file is not a photograph the shop can show (JPG, PNG or WebP).';
  if (/fetch|network|Load failed/i.test(m)) return 'The store could not reach its server. Check the connection and try again.';
  return m;
}

// ---------------------------------------------------------------------------
// The page can say why there is nothing to edit.
// ---------------------------------------------------------------------------
function unavailable(ctx) {
  if (!ctx.productsError) return '';
  const m = String(ctx.productsError.message || ctx.productsError);
  if (/NOT_SET_UP/.test(m)) {
    return notice('warn', `<b>The products are not in the database yet.</b> Run
      <code>db/SETUP.md</code> step 11 in Supabase — <code>schema.sql</code>, then
      <code>selftest.sql</code>. Until then the shop shows the products from the
      site's own file, and nothing can be changed here.`);
  }
  return notice('bad', `<b>The products could not be read.</b> ${esc(said(m))}`);
}

const oneBrowser = () => (store.shared() ? '' : notice('info', `<b>One-browser mode.</b>
  A change made here is seen in this browser only, and photographs cannot be uploaded.
  With the database connected, every change reaches every customer.`));

/** "124 pieces · XL sold out in Navy", or what is left when it is little. */
function stockLine(p, shop) {
  if (p.kind === 'voucher') return 'Not stocked';
  const skus = p.skus || {};
  const keys = D.skuKeys(p.variants);
  const out = keys.filter((k) => !(Number(skus[k]) > 0));
  const low = keys.filter((k) => Number(skus[k]) > 0 && Number(skus[k]) <= (shop.lowStockAt || 0));
  if (!p.stock) return '<span class="pm-out">Sold out</span>';
  const bits = [`${D.fmtInt(p.stock)} ${p.stock === 1 ? 'piece' : 'pieces'}`];
  if (out.length) bits.push(`<span class="pm-out">${out.length} ${out.length === 1 ? 'size' : 'sizes'} sold out</span>`);
  if (low.length) bits.push(`<span class="pm-low">${low.length} running low</span>`);
  return bits.join(' · ');
}

// ---------------------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------------------
export function renderCatalogue(ctx) {
  const why = unavailable(ctx);
  if (why) return why;
  const id = ctx.query.p;
  if (id === 'new') return editor(ctx, null);
  if (id) {
    const p = ctx.products.find((x) => x.id === id);
    if (!p) {
      return notice('warn', `There is no product <code>${esc(id)}</code>.
        <a href="#/catalogue">Back to the products</a>.`);
    }
    return editor(ctx, p);
  }
  if (ed) ed = null;     // the list: nothing open
  return productList(ctx);
}

function productList({ products, cats, shop, query }) {
  const shown = products.filter((p) => !p.hidden).length;
  return `
  <div class="adm-bar">
    <input class="adm-search" type="search" id="adm-q" value="${esc(query.q || '')}"
      placeholder="Search ${products.length} products" aria-label="Search the products">
    <a class="btn btn-sm btn-primary" href="#/catalogue?p=new">${icon('plus', 14)} Add a product</a>
  </div>
  ${oneBrowser()}
  <p class="t-micro dim pm-count">${shown} in the shop${products.length > shown
    ? ` · ${products.length - shown} hidden` : ''} · tap a product to change its photographs,
    colours, sizes, stock and words</p>
  <ul class="pm-list">
    ${products.map((p) => `
    <li class="pm-row${p.hidden ? ' is-hidden' : ''}" data-row="${esc(p.id)}">
      <a class="pm-thumb" href="#/catalogue?p=${encodeURIComponent(p.id)}" aria-hidden="true" tabindex="-1">${
        (p.img || []).length ? art(p, 0) : '<span class="pm-nophoto">No photo</span>'}</a>
      <div class="pm-main">
        <a class="pm-name" href="#/catalogue?p=${encodeURIComponent(p.id)}">${esc(p.name)}</a>
        <div class="pm-meta">${esc(filedAs(p, cats))}${p.hidden ? ' · <span class="pill pill-bad">Hidden</span>' : ''}</div>
        <div class="pm-price"><b>${D.rupees(p.price)}</b>${p.mrp > p.price
          ? ` <s>${D.rupees(p.mrp)}</s> <span>−${D.discountPct(p)}%</span>` : ''}</div>
        <div class="pm-stock">${stockLine(p, shop)}</div>
      </div>
      <div class="pm-acts">
        <button type="button" class="btn btn-sm btn-secondary" data-price="${esc(p.id)}">Change price</button>
        <a class="btn btn-sm btn-ghost" href="#/inventory?p=${encodeURIComponent(p.id)}">Stock</a>
        <a class="btn btn-sm btn-ghost" href="#/catalogue?p=${encodeURIComponent(p.id)}">Edit</a>
      </div>
    </li>`).join('')}
  </ul>
  ${products.length ? '' : `<p class="t-micro dim" style="padding:var(--s4) 0">No products yet.
    <a href="#/catalogue?p=new">Add the first one</a>.</p>`}`;
}

/** The price and the MRP, in a pop-up, and nothing else. */
async function changePrice(p, repaint) {
  const ans = await askFirst({
    title: `Price of ${p.name}`,
    body: `Whole rupees. Customers pay the price; the MRP is shown struck through
      beside it when it is higher. Sizes that cost more keep their extra on top.`,
    more: `<div class="pm-pricebox">
      <label>Price (₹)<input name="price" type="number" inputmode="numeric" min="1" step="1" value="${p.price}"></label>
      <label>MRP (₹)<input name="mrp" type="number" inputmode="numeric" min="1" step="1" value="${p.mrp}"></label>
    </div>`,
    yes: 'Save the price', no: 'Cancel',
  });
  if (!ans) return;
  const price = whole(ans.price);
  const mrp = whole(ans.mrp);
  if (!(price >= 1)) { toast('The price must be a whole number of rupees, 1 or more.'); return; }
  if (!(mrp >= price)) { toast('The MRP must be at least the price. To show no saving, make them the same.'); return; }
  try {
    await store.catalogAdmin.setPrice(p.id, price, mrp);
    toast(`${p.name} is ${D.rupees(price)} now${mrp > price ? `, MRP ${D.rupees(mrp)}` : ''}.`);
    repaint();
  } catch (e) {
    toast(said(e));
  }
}

// ---------------------------------------------------------------------------
// THE EDITOR -- one product, new or not. Its work lives in `ed` while it is
// open: the form writes into ed.d on every keystroke, and a change of shape
// (a colour, a size or a photograph added, moved or taken away) draws the
// form again from it.
//
// Colours and sizes each carry `ref`, which never changes while the editor
// is open, so a stock box keeps its number when a colour is renamed or
// another is added. A colour or size that exists keeps its `id` for good:
// bags and orders name it.
// ---------------------------------------------------------------------------
let ed = null;     // { key, d, ctx, uploading }
let refs = 0;
const ref = () => `r${(refs += 1)}`;

/** True while the store page must not redraw over unsaved work. */
export function busy() {
  return (!!ed && !!document.getElementById('pm-editor')) || stockDirty();
}

/** The shop's usual sizes, and the extra the larger ones carry. */
const PRESETS = {
  'S to XXL': [['S', 0], ['M', 0], ['L', 0], ['XL', 50], ['XXL', 100]],
  'XS to XXL': [['XS', 0], ['S', 0], ['M', 0], ['L', 0], ['XL', 50], ['XXL', 100]],
  'One size': [['Free size', 0]],
};

function draftFrom(p, ctx) {
  const photos = (p.img || []).slice();
  const colours = ((p.variants && p.variants.colour) || []).map((c) => ({
    ref: ref(), id: c.id, label: c.label, swatch: c.swatch,
    photo: c.img != null && photos[c.img] ? photos[c.img] : null,
  }));
  const sizes = ((p.variants && p.variants.size) || []).map((s) => ({
    ref: ref(), id: s.id, label: s.label, delta: s.delta || 0,
  }));
  const stock = {};
  const skus = p.skus || {};
  for (const c of colours.length ? colours : [{ ref: '', id: '' }]) {
    for (const s of sizes.length ? sizes : [{ ref: '', id: '' }]) {
      stock[`${c.ref}|${s.ref}`] = Number(skus[keyOf(colours.length ? c.id : '', sizes.length ? s.id : '')]) || 0;
    }
  }
  return {
    id: p.id || null, slug: p.slug || '',
    name: p.name || '', filed: `${p.cat || ''}|${p.sub || ''}`,
    price: p.price != null ? String(p.price) : '', mrp: p.mrp != null ? String(p.mrp) : '',
    shortDesc: p.shortDesc || '', desc: p.desc || '', sizeChart: p.sizeChart || '',
    photos, colours, sizes, stock, was: { ...skus },
    specs: (p.specs || []).map((s) => ({ k: s.k, v: s.v })),
    bestseller: (p.badges || []).includes('bestseller'),
    badges: (p.badges || []).filter((b) => b !== 'bestseller'),
    tags: (p.tags || []).slice(),
    hidden: !!p.hidden,
  };
}

const keyOf = (cid, sid) => (cid && sid ? `${cid}/${sid}` : cid || sid || 'one');

/** A new product starts in the first subcategory, or the one asked for,
 *  in S to XXL, one colour to name, and the size chart its neighbours use. */
function blank(ctx) {
  const first = filing(ctx.cats)[0];
  const d = draftFrom({}, ctx);
  d.filed = first ? first.value : '|';
  d.sizes = PRESETS['S to XXL'].map(([label, delta]) => ({ ref: ref(), id: null, label, delta }));
  d.colours = [{ ref: ref(), id: null, label: '', swatch: neutral(), picked: false, photo: null }];
  d.specs = [{ k: 'Fit', v: '' }, { k: 'Material', v: '' }];
  d.sizeChart = chartFor(d.filed, ctx);
  d.stock = {};
  return d;
}

/** The chart most products in that subcategory use. */
function chartFor(filed, ctx) {
  const [cat, sub] = filed.split('|');
  const counts = {};
  for (const p of ctx.products) {
    if (p.cat === cat && (p.sub || '') === sub && p.sizeChart) counts[p.sizeChart] = (counts[p.sizeChart] || 0) + 1;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
}

function editor(ctx, p) {
  const key = p ? p.id : 'new';
  if (!ed || ed.key !== key) ed = { key, d: p ? draftFrom(p, ctx) : blank(ctx), uploading: 0 };
  ed.ctx = ctx;
  return `<div id="pm-editor">${editorHtml()}</div>`;
}

function editorHtml() {
  const { d, ctx } = ed;
  const isNew = !d.id;
  const charts = (ctx.shop && ctx.shop.sizeCharts) || {};
  const priceN = whole(d.price);
  const mrpN = whole(d.mrp);
  const off = priceN > 0 && mrpN > priceN ? Math.round((mrpN - priceN) / mrpN * 100) : 0;
  const uploads = store.catalogAdmin.uploads;

  return `
  <div class="adm-bar">
    <a class="btn btn-sm btn-ghost" href="#/catalogue">${icon('left', 14)} All products</a>
    ${d.id && !d.hidden ? `<a class="btn btn-sm btn-ghost" href="./#/p/${encodeURIComponent(d.slug)}"
      target="_blank" rel="noopener">See it in the shop</a>` : ''}
  </div>
  <h2 class="t-h2">${isNew ? 'A new product' : esc(d.name || 'This product')}</h2>
  ${oneBrowser()}

  <form class="ed" id="pm-form" novalidate>
    <section class="panel ed-sec">
      <h3 class="t-h3">Photographs</h3>
      <p class="t-micro dim">The first is the one on the card. Each is made 4:5 — the
        shape of every photograph in the shop — and cut from the middle.</p>
      <div class="ed-photos">
        ${d.photos.map((src, i) => `
        <figure class="ed-photo" data-photo="${i}">
          <img src="${esc(src)}" alt="Photograph ${i + 1}" loading="lazy">
          <figcaption>${i === 0 ? 'Card' : i + 1}</figcaption>
          <div class="ed-photo-acts">
            <button type="button" data-ph-left="${i}" aria-label="Move photograph ${i + 1} earlier" ${i === 0 ? 'disabled' : ''}>${icon('left', 14)}</button>
            <button type="button" data-ph-right="${i}" aria-label="Move photograph ${i + 1} later" ${i === d.photos.length - 1 ? 'disabled' : ''}>${icon('chevron', 14)}</button>
            <button type="button" data-ph-rm="${i}" aria-label="Remove photograph ${i + 1}">${icon('close', 14)}</button>
          </div>
        </figure>`).join('')}
        ${ed.uploading ? Array.from({ length: ed.uploading }, () => `
        <figure class="ed-photo is-busy"><span>Uploading…</span></figure>`).join('') : ''}
        ${d.photos.length + ed.uploading < LIMIT.photos ? `
        <label class="ed-add${uploads ? '' : ' is-off'}">
          <input type="file" accept="image/*" multiple data-ph-add ${uploads ? '' : 'disabled'}>
          ${icon('plus', 18)}<span>${uploads ? 'Add photographs' : 'Uploads need the database'}</span>
        </label>` : ''}
      </div>
      <div class="adm-err" data-err="photos" hidden></div>
    </section>

    <section class="panel ed-sec">
      <h3 class="t-h3">What it is</h3>
      <div class="adm-field" data-field="name"><label for="ed-name">Name</label>
        <input id="ed-name" name="name" type="text" maxlength="120" value="${esc(d.name)}"
          placeholder="e.g. Linen Camp-Collar Shirt">
        <div class="adm-err" hidden></div></div>
      <div class="ed-two">
        <div class="adm-field" data-field="filed"><label for="ed-filed">Category</label>
          <select id="ed-filed" name="filed">
            ${filing(ctx.cats).map((o) => `<option value="${esc(o.value)}"${o.value === d.filed ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select><div class="adm-err" hidden></div></div>
        <div class="adm-field" data-field="sizeChart"><label for="ed-chart">Size chart</label>
          <select id="ed-chart" name="sizeChart">
            <option value="">No size chart</option>
            ${Object.keys(charts).sort().map((k) => `<option value="${esc(k)}"${k === d.sizeChart ? ' selected' : ''}>${esc(charts[k].label || k)}</option>`).join('')}
          </select><div class="adm-err" hidden></div></div>
      </div>
      <div class="adm-field" data-field="shortDesc"><label for="ed-short">One line, on the card</label>
        <input id="ed-short" name="shortDesc" type="text" maxlength="300" value="${esc(d.shortDesc)}"
          placeholder="e.g. A camp collar, short sleeves and a chest pocket.">
        <div class="adm-err" hidden></div></div>
      <div class="adm-field" data-field="desc"><label for="ed-desc">About it, on its page</label>
        <textarea id="ed-desc" name="desc" rows="4" maxlength="4000">${esc(d.desc)}</textarea>
        <div class="adm-err" hidden></div></div>
    </section>

    <section class="panel ed-sec">
      <h3 class="t-h3">Price</h3>
      <div class="ed-two">
        <div class="adm-field" data-field="price"><label for="ed-price">Price (₹)</label>
          <input id="ed-price" name="price" type="number" inputmode="numeric" min="1" step="1" value="${esc(d.price)}">
          <div class="adm-err" hidden></div></div>
        <div class="adm-field" data-field="mrp"><label for="ed-mrp">MRP (₹)</label>
          <input id="ed-mrp" name="mrp" type="number" inputmode="numeric" min="1" step="1" value="${esc(d.mrp)}">
          <div class="adm-err" hidden></div></div>
      </div>
      <p class="t-micro dim" data-off>${off ? `Customers see ${D.rupees(priceN)}, with ${D.rupees(mrpN)} struck through: ${off}% off.`
        : 'Whole rupees. With the MRP the same as the price, no saving is shown.'}</p>
    </section>

    <section class="panel ed-sec">
      <h3 class="t-h3">Colours</h3>
      <p class="t-micro dim">Each colour, the dot customers tap, and the photograph that shows it.</p>
      <div class="ed-rows">
        ${d.colours.map((c, i) => `
        <div class="ed-colour" data-colour="${c.ref}">
          <input type="color" value="${esc(/^#[0-9a-f]{6}$/i.test(c.swatch) ? c.swatch : neutral())}"
            data-c-swatch aria-label="The colour of ${esc(c.label || 'colour ' + (i + 1))}">
          <input type="text" maxlength="40" value="${esc(c.label)}" data-c-label
            placeholder="e.g. Navy" aria-label="Colour ${i + 1}, its name">
          <select data-c-photo aria-label="The photograph of ${esc(c.label || 'colour ' + (i + 1))}">
            <option value="">No photograph</option>
            ${d.photos.map((src, j) => `<option value="${esc(src)}"${src === c.photo ? ' selected' : ''}>Photograph ${j + 1}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-sm btn-ghost" data-c-rm="${c.ref}"
            aria-label="Remove ${esc(c.label || 'this colour')}">${icon('close', 14)}</button>
        </div>`).join('')}
      </div>
      ${d.colours.length < LIMIT.colours ? `<button type="button" class="btn btn-sm btn-secondary" data-c-add>${icon('plus', 14)} Add a colour</button>` : ''}
      <div class="adm-err" data-err="colours" hidden></div>
    </section>

    <section class="panel ed-sec">
      <h3 class="t-h3">Sizes</h3>
      <p class="t-micro dim">The extra is added to the price for that size — larger sizes take more cloth.</p>
      <div class="ed-presets">Start from:
        ${Object.keys(PRESETS).map((k) => `<button type="button" class="chip" data-preset="${esc(k)}">${esc(k)}</button>`).join('')}
      </div>
      <div class="ed-rows">
        ${d.sizes.map((s, i) => `
        <div class="ed-size" data-size="${s.ref}">
          <input type="text" maxlength="10" value="${esc(s.label)}" data-s-label aria-label="Size ${i + 1}, its name">
          <label class="ed-delta">+ ₹<input type="number" inputmode="numeric" step="1" value="${esc(String(s.delta))}"
            data-s-delta aria-label="The extra for size ${esc(s.label || String(i + 1))}"></label>
          <button type="button" class="btn btn-sm btn-ghost" data-s-rm="${s.ref}"
            aria-label="Remove size ${esc(s.label || String(i + 1))}">${icon('close', 14)}</button>
        </div>`).join('')}
      </div>
      ${d.sizes.length < LIMIT.sizes ? `<button type="button" class="btn btn-sm btn-secondary" data-s-add>${icon('plus', 14)} Add a size</button>` : ''}
      <div class="adm-err" data-err="sizes" hidden></div>
    </section>

    <section class="panel ed-sec">
      <h3 class="t-h3">Stock</h3>
      <p class="t-micro dim">${isNew ? 'How many pieces you have of each colour in each size.'
        : 'How many pieces you have of each colour in each size. An order placed while this is open still counts.'}
        A size at 0 shows as sold out.</p>
      ${stockTable(d.colours, d.sizes, (cr, sr) => d.stock[`${cr}|${sr}`] || 0, 'ed')}
      <div class="adm-err" data-err="stock" hidden></div>
    </section>

    <section class="panel ed-sec">
      <h3 class="t-h3">Details</h3>
      <p class="t-micro dim">Shown on its page under "Specifications": the cloth, the fit, how to wash it.</p>
      <div class="ed-rows">
        ${d.specs.map((s, i) => `
        <div class="ed-spec" data-spec="${i}">
          <input type="text" maxlength="60" value="${esc(s.k)}" data-k placeholder="e.g. Material" aria-label="Detail ${i + 1}, what it is">
          <input type="text" maxlength="300" value="${esc(s.v)}" data-v placeholder="e.g. 100% cotton" aria-label="Detail ${i + 1}, the words">
          <button type="button" class="btn btn-sm btn-ghost" data-spec-rm="${i}" aria-label="Remove detail ${i + 1}">${icon('close', 14)}</button>
        </div>`).join('')}
      </div>
      ${d.specs.length < LIMIT.specs ? `<button type="button" class="btn btn-sm btn-secondary" data-spec-add>${icon('plus', 14)} Add a detail</button>` : ''}
      <div class="adm-err" data-err="specs" hidden></div>
    </section>

    <section class="panel ed-sec">
      <label class="ed-check"><input type="checkbox" name="shown" ${d.hidden ? '' : 'checked'}>
        <span><b>Show it in the shop</b><br><span class="t-micro dim">Untick to keep it out of
          the shop while you finish it. A product is never deleted: bags and past orders still find it.</span></span></label>
      <label class="ed-check"><input type="checkbox" name="bestseller" ${d.bestseller ? 'checked' : ''}>
        <span><b>One of the bestsellers</b><br><span class="t-micro dim">It goes in the
          Bestsellers row on the home page.</span></span></label>
    </section>

    <div class="adm-save">
      <button class="btn btn-primary" type="submit" data-save ${ed.uploading ? 'disabled' : ''}>${isNew ? 'Add the product' : 'Save the changes'}</button>
      <a class="btn btn-secondary" href="#/catalogue">Cancel</a>
      <div class="adm-errs" id="ed-errs" hidden></div>
    </div>
  </form>`;
}

/** Colours down, sizes across, a box for each. `cell(colourRef, sizeRef)`
 *  is the number to show; `data-was` remembers it. */
function stockTable(colours, sizes, cell, kind, extra = '') {
  const rows = colours.length ? colours : [{ ref: '', label: '', swatch: '' }];
  const cols = sizes.length ? sizes : [{ ref: '', label: 'Stock' }];
  return `<div class="inv-wrap"><table class="inv-grid">
    <thead><tr><th scope="col">${colours.length ? 'Colour' : ''}</th>
      ${cols.map((s) => `<th scope="col">${esc(s.label || '?')}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((c) => `<tr>
      <th scope="row">${colours.length ? `<span class="adm-swatch" style="background:${esc(c.swatch)}"></span>${esc(c.label || '…')}` : ''}</th>
      ${cols.map((s) => {
        const n = cell(c.ref, s.ref);
        return `<td><input type="number" inputmode="numeric" min="0" step="1" value="${n}"
          data-${kind}-cell="${esc(c.ref)}|${esc(s.ref)}" data-was="${n}" ${extra}
          class="${n === 0 ? 'is-out' : ''}"
          aria-label="${esc([c.label, s.label].filter(Boolean).join(' · ') || 'Stock')}"></td>`;
      }).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// The editor's form, read back into ed.d. Called on every input, and before
// anything that draws the form again.
// ---------------------------------------------------------------------------
function sync(form) {
  const d = ed.d;
  const g = (n) => (form.elements[n] ? form.elements[n].value : '');
  d.name = g('name'); d.filed = g('filed'); d.sizeChart = g('sizeChart');
  d.shortDesc = g('shortDesc'); d.desc = g('desc');
  d.price = g('price'); d.mrp = g('mrp');
  d.hidden = !form.elements.shown.checked;
  d.bestseller = form.elements.bestseller.checked;
  for (const row of $$('[data-colour]', form)) {
    const c = d.colours.find((x) => x.ref === row.dataset.colour);
    if (!c) continue;
    c.label = $('[data-c-label]', row).value;
    c.swatch = $('[data-c-swatch]', row).value.toUpperCase();
    c.photo = $('[data-c-photo]', row).value || null;
  }
  for (const row of $$('[data-size]', form)) {
    const s = d.sizes.find((x) => x.ref === row.dataset.size);
    if (!s) continue;
    s.label = $('[data-s-label]', row).value;
    s.delta = $('[data-s-delta]', row).value;
  }
  d.specs = $$('[data-spec]', form).map((row) => ({ k: $('[data-k]', row).value, v: $('[data-v]', row).value }));
  for (const box of $$('[data-ed-cell]', form)) d.stock[box.dataset.edCell] = box.value;
}

/** Everything wrong with the product, each at its field. */
function check(d, ctx) {
  const errs = [];
  const bad = (field, msg) => errs.push({ field, msg });
  const name = d.name.trim();
  if (!name) bad('name', 'A product needs a name.');
  else if (!slugify(name)) bad('name', 'The name needs at least one letter or digit.');
  if (!d.filed || d.filed === '|') bad('filed', 'Choose where it goes in the shop.');
  const price = whole(d.price);
  const mrp = whole(d.mrp);
  if (!(price >= 1 && price <= 100000)) bad('price', 'Whole rupees, 1 or more.');
  if (!(mrp >= 1 && mrp <= 100000)) bad('mrp', 'Whole rupees, 1 or more.');
  else if (price >= 1 && mrp < price) bad('mrp', 'The MRP cannot be below the price. To show no saving, make them the same.');
  if (d.shortDesc.length > 300) bad('shortDesc', 'At most 300 letters.');
  if (d.desc.length > 4000) bad('desc', 'At most 4,000 letters.');

  if (!d.hidden && !d.photos.length) bad('photos', 'A product in the shop needs at least one photograph — add one, or untick "Show it in the shop" below.');

  const cnames = d.colours.map((c) => slugify(c.label, 30));
  if (d.colours.some((c) => !c.label.trim())) bad('colours', 'Every colour needs a name — or remove the ones you do not need.');
  else if (cnames.some((n) => !n)) bad('colours', 'A colour name needs at least one letter.');
  else if (new Set(cnames).size !== cnames.length) bad('colours', 'Two colours have the same name.');
  if (d.colours.some((c) => !/^#[0-9A-Fa-f]{6}$/.test(c.swatch))) bad('colours', 'Choose the colour of every dot.');
  const unpicked = d.colours.filter((c) => c.picked === false);
  if (unpicked.length) {
    bad('colours', `Choose the dot for ${unpicked.map((c) => c.label.trim() || 'the new colour').join(', ')}: tap the square beside the name.`);
  }

  const snames = d.sizes.map((s) => slugify(s.label, 10));
  if (d.sizes.some((s) => !s.label.trim())) bad('sizes', 'Every size needs a name — or remove the ones you do not need.');
  else if (snames.some((n) => !n)) bad('sizes', 'A size name needs at least one letter or digit.');
  else if (new Set(snames).size !== snames.length) bad('sizes', 'Two sizes have the same name.');
  for (const s of d.sizes) {
    const n = signed(s.delta);
    if (Number.isNaN(n) || Math.abs(n) > 99999) { bad('sizes', `The extra for ${s.label || 'a size'} must be whole rupees.`); break; }
    if (price >= 1 && price + n < 1) { bad('sizes', `${s.label} would cost nothing at this price.`); break; }
  }

  for (const v of Object.values(d.stock)) {
    const n = whole(v);
    if (Number.isNaN(n) || n > 100000) { bad('stock', 'Stock must be whole numbers, 0 or more.'); break; }
  }

  const specs = d.specs.filter((s) => s.k.trim() || s.v.trim());
  if (specs.some((s) => !s.k.trim() || !s.v.trim())) bad('specs', 'Each detail needs both what it is and the words — or remove it.');

  // The size chart must have a row for every size, or the table on the
  // product page shows a blank one (data.pl holds the file to the same).
  const chart = d.sizeChart && ctx.shop.sizeCharts && ctx.shop.sizeCharts[d.sizeChart];
  if (chart) {
    const missing = d.sizes.filter((s) => !(s.id || slugify(s.label, 10)) || !chart.rows[s.id || slugify(s.label, 10)]);
    if (missing.length) {
      bad('sizeChart', `The ${chart.label || d.sizeChart} chart has no measurements for ${missing.map((s) => s.label).join(', ')}. Choose another chart, or no size chart.`);
    }
  }
  return errs;
}

function showErrors(form, errs) {
  for (const f of $$('.adm-field', form)) {
    f.classList.remove('has-err');
    const b = $('.adm-err', f);
    if (b) { b.hidden = true; b.textContent = ''; }
  }
  for (const b of $$('[data-err]', form)) { b.hidden = true; b.textContent = ''; }
  const sum = $('#ed-errs', form);
  sum.hidden = !errs.length;
  sum.innerHTML = errs.map((e) => `<div>${esc(e.msg)}</div>`).join('');
  for (const e of errs) {
    const f = $(`.adm-field[data-field="${e.field}"]`, form);
    const b = f ? $('.adm-err', f) : $(`[data-err="${e.field}"]`, form);
    if (f) f.classList.add('has-err');
    if (b) { b.hidden = false; b.textContent = e.msg; }
  }
  if (errs.length) {
    const first = $('.has-err input, .has-err select, .has-err textarea', form) || sum;
    first.scrollIntoView({ block: 'center' });
  }
}

/** ed.d as the server takes it. Ids are given to new colours and sizes
 *  here, once; stock goes with the NEW colours and sizes only -- what exists
 *  changes by set_stock's difference (see the top of this file). */
function build(d, products) {
  const colours = d.colours.map((c) => ({ ...c }));
  const sizes = d.sizes.map((s) => ({ ...s }));
  const take = (list, max) => {
    const used = new Set(list.filter((x) => x.id).map((x) => x.id));
    for (const x of list) {
      if (x.id) continue;
      const base = slugify(x.label, max) || 'x';
      let id = base;
      for (let n = 2; used.has(id); n += 1) id = `${base.slice(0, max - String(n).length - 1)}-${n}`;
      used.add(id);
      x.id = id;
    }
  };
  take(colours, 30);
  take(sizes, 10);

  let slug = d.slug;
  if (!d.id) {
    const taken = new Set(products.map((p) => p.slug));
    const base = slugify(d.name) || 'product';
    slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base.slice(0, 52)}-${n}`;
  }
  const [cat, sub] = d.filed.split('|');
  const photos = d.photos.slice();
  const skus = {};
  const now = {};
  for (const c of colours.length ? colours : [{ ref: '', id: '' }]) {
    for (const s of sizes.length ? sizes : [{ ref: '', id: '' }]) {
      const k = keyOf(colours.length ? c.id : '', sizes.length ? s.id : '');
      now[k] = whole(d.stock[`${c.ref}|${s.ref}`] || 0) || 0;
      if (!d.id || !(k in d.was)) skus[k] = now[k];
    }
  }
  const words = d.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const product = {
    ...(d.id ? { id: d.id } : {}),
    slug, name: d.name.trim(), cat, sub: sub || null,
    price: whole(d.price), mrp: whole(d.mrp),
    shortDesc: d.shortDesc.trim(), desc: d.desc.trim(),
    sizeChart: d.sizeChart || null,
    img: photos,
    variants: {
      ...(colours.length ? { colour: colours.map((c) => ({
        id: c.id, label: c.label.trim(), swatch: c.swatch.toUpperCase(), delta: 0,
        ...(c.photo && photos.includes(c.photo) ? { img: photos.indexOf(c.photo) } : {}),
      })) } : {}),
      ...(sizes.length ? { size: sizes.map((s) => ({ id: s.id, label: s.label.trim(), delta: signed(s.delta) })) } : {}),
    },
    skus,
    specs: d.specs.filter((s) => s.k.trim() && s.v.trim()).map((s) => ({ k: s.k.trim(), v: s.v.trim() })),
    badges: [...d.badges, ...(d.bestseller ? ['bestseller'] : [])],
    tags: d.tags.length ? d.tags : [...new Set([...words, ...colours.map((c) => slugify(c.label, 40))])].slice(0, 20),
    hidden: d.hidden,
  };
  // What changed of the stock that exists: [what the page showed, what was typed].
  const changes = {};
  if (d.id) {
    for (const [k, n] of Object.entries(now)) {
      if (k in d.was && Number(d.was[k]) !== n) changes[k] = [Number(d.was[k]) || 0, n];
    }
  }
  return { product, changes };
}

/** A photograph, as the shop shows them: 4:5, at most 1024 by 1280, a
 *  JPEG. The largest 4:5 window, from the middle; never made larger. */
async function shrinkPhoto(file) {
  if (file.type && !/^image\//.test(file.type)) throw new Error('NOT_A_PHOTO');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error('UNREADABLE'));
      i.src = url;
    });
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) throw new Error('UNREADABLE');
    let sw = W;
    let sh = Math.round(W * 5 / 4);
    if (sh > H) { sh = H; sw = Math.round(H * 4 / 5); }
    const ow = Math.min(1024, sw);
    const oh = Math.round(ow * 5 / 4);
    const c = document.createElement('canvas');
    c.width = ow;
    c.height = oh;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, Math.round((W - sw) / 2), Math.round((H - sh) / 2), sw, sh, 0, 0, ow, oh);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
    if (!blob) throw new Error('UNREADABLE');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function wireEditor(host, repaint) {
  const box = $('#pm-editor', host);
  if (!box || !ed) return;
  const form = () => $('#pm-form', box);
  const redraw = () => { box.innerHTML = editorHtml(); };
  const paintOff = () => {
    const d = ed.d;
    const p = whole(d.price);
    const m = whole(d.mrp);
    const off = p > 0 && m > p ? Math.round((m - p) / m * 100) : 0;
    const el = $('[data-off]', box);
    if (el) {
      el.textContent = off ? `Customers see ${D.rupees(p)}, with ${D.rupees(m)} struck through: ${off}% off.`
        : 'Whole rupees. With the MRP the same as the price, no saving is shown.';
    }
  };

  box.addEventListener('input', (e) => {
    if (!form()) return;
    sync(form());
    if (e.target.matches('[data-c-swatch]')) {
      const c = ed.d.colours.find((x) => x.ref === e.target.closest('[data-colour]').dataset.colour);
      if (c) c.picked = true;
    }
    if (e.target.name === 'price' || e.target.name === 'mrp') paintOff();
    if (e.target.matches('[data-ed-cell]')) e.target.classList.toggle('is-out', whole(e.target.value) === 0);
    // A colour's name or dot changes the stock table's row heading.
    if (e.target.matches('[data-c-label], [data-c-swatch], [data-s-label]')) {
      const t = $('.inv-wrap', box);
      if (t) {
        const fresh = document.createElement('div');
        fresh.innerHTML = stockTable(ed.d.colours, ed.d.sizes, (cr, sr) => whole(ed.d.stock[`${cr}|${sr}`] || 0) || 0, 'ed');
        // Head only: the boxes keep their focus and what is in them.
        const thead = $('thead', t);
        const rows = $$('tbody th', t);
        thead.replaceWith($('thead', fresh));
        $$('tbody th', fresh).forEach((th, i) => { if (rows[i]) rows[i].replaceWith(th); });
      }
    }
  });
  box.addEventListener('change', (e) => {
    if (!form()) return;
    sync(form());
    if (e.target.name === 'filed' && !ed.d.sizeChart) {
      ed.d.sizeChart = chartFor(ed.d.filed, ed.ctx);
      redraw();
    }
    if (e.target.matches('[data-ph-add]')) addPhotos(e.target);
  });

  box.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !form()) return;
    const d = ed.d;
    const at = (attr) => Number(t.getAttribute(attr));
    sync(form());
    if (t.hasAttribute('data-ph-left') || t.hasAttribute('data-ph-right')) {
      const i = at(t.hasAttribute('data-ph-left') ? 'data-ph-left' : 'data-ph-right');
      const j = t.hasAttribute('data-ph-left') ? i - 1 : i + 1;
      if (j < 0 || j >= d.photos.length) return;
      [d.photos[i], d.photos[j]] = [d.photos[j], d.photos[i]];
      redraw();
    } else if (t.hasAttribute('data-ph-rm')) {
      const [gone] = d.photos.splice(at('data-ph-rm'), 1);
      for (const c of d.colours) if (c.photo === gone) c.photo = null;
      redraw();
    } else if (t.hasAttribute('data-c-add')) {
      const free = d.photos.find((src) => !d.colours.some((c) => c.photo === src)) || null;
      d.colours.push({ ref: ref(), id: null, label: '', swatch: neutral(), picked: false, photo: free });
      redraw();
      const rows = $$('[data-c-label]', box);
      if (rows.length) rows[rows.length - 1].focus();
    } else if (t.hasAttribute('data-c-rm')) {
      d.colours = d.colours.filter((c) => c.ref !== t.getAttribute('data-c-rm'));
      redraw();
    } else if (t.hasAttribute('data-s-add')) {
      d.sizes.push({ ref: ref(), id: null, label: '', delta: 0 });
      redraw();
      const rows = $$('[data-s-label]', box);
      if (rows.length) rows[rows.length - 1].focus();
    } else if (t.hasAttribute('data-s-rm')) {
      d.sizes = d.sizes.filter((s) => s.ref !== t.getAttribute('data-s-rm'));
      redraw();
    } else if (t.hasAttribute('data-preset')) {
      // Sizes the product already has keep their ids and stock; the rest go.
      const keep = new Map(d.sizes.map((s) => [slugify(s.label, 10), s]));
      d.sizes = PRESETS[t.getAttribute('data-preset')].map(([label, delta]) => {
        const old = keep.get(slugify(label, 10));
        return old ? { ...old, label, delta } : { ref: ref(), id: null, label, delta };
      });
      redraw();
    } else if (t.hasAttribute('data-spec-add')) {
      d.specs.push({ k: '', v: '' });
      redraw();
      const rows = $$('[data-k]', box);
      if (rows.length) rows[rows.length - 1].focus();
    } else if (t.hasAttribute('data-spec-rm')) {
      d.specs.splice(at('data-spec-rm'), 1);
      redraw();
    }
  });

  async function addPhotos(input) {
    const files = Array.from(input.files || []).slice(0, LIMIT.photos - ed.d.photos.length - ed.uploading);
    input.value = '';
    if (!files.length) return;
    const mine = ed;
    mine.uploading += files.length;
    redraw();
    let done = 0;
    for (const f of files) {
      try {
        const blob = await shrinkPhoto(f);
        const src = await store.catalogAdmin.uploadPhoto(blob, mine.d.id || 'new');
        mine.d.photos.push(src);
        // A colour with no photograph takes the first one uploaded.
        const bare = mine.d.colours.find((c) => !c.photo);
        if (bare) bare.photo = src;
        done += 1;
      } catch (e) {
        toast(/NOT_A_PHOTO|UNREADABLE/.test(String(e && e.message))
          ? `${f.name} could not be read as a photograph. Try a JPG or PNG.` : said(e));
      }
      mine.uploading -= 1;
      if (ed === mine && box.isConnected) redraw();
    }
    if (done) toast(`${done} ${done === 1 ? 'photograph' : 'photographs'} added. Save to keep ${done === 1 ? 'it' : 'them'}.`);
  }

  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form();
    if (!f || ed.uploading) return;
    sync(f);
    const errs = check(ed.d, ed.ctx);
    showErrors(f, errs);
    if (errs.length) return;
    const btn = $('[data-save]', f);
    btn.disabled = true;
    const isNew = !ed.d.id;
    try {
      const { product, changes } = build(ed.d, ed.ctx.products);
      const saved = await store.catalogAdmin.save(product);
      if (Object.keys(changes).length) await store.catalogAdmin.setStock(saved.id, changes);
      ed = null;
      toast(isNew
        ? `${saved.name} is added${saved.hidden ? ', hidden for now' : ' and in the shop'}.`
        : `${saved.name} is saved.`);
      if (location.hash === '#/catalogue') repaint(); else location.hash = '#/catalogue';
    } catch (err) {
      btn.disabled = false;
      showErrors(f, [{ field: 'save', msg: said(err) }]);
    }
  });
}

// ---------------------------------------------------------------------------
// INVENTORY -- every product's stock, colour by size, saved together. A box
// changed is marked; Save sends each product's changes as differences.
// ---------------------------------------------------------------------------
let stockHost = null;
function stockDirty() {
  return !!stockHost && stockHost.isConnected
    && $$('[data-inv-cell]', stockHost).some((i) => i.value !== i.dataset.was);
}

export function renderInventory(ctx) {
  const why = unavailable(ctx);
  if (why) return why;
  const { products, shop } = ctx;
  const low = shop.lowStockAt || 0;
  let out = 0;
  let few = 0;
  for (const p of products) {
    for (const k of D.skuKeys(p.variants)) {
      const n = Number((p.skus || {})[k]) || 0;
      if (n === 0) out += 1; else if (n <= low) few += 1;
    }
  }
  return `
  ${oneBrowser()}
  ${notice('info', `<b>How many pieces you have of each colour in each size.</b> An order
    takes its pieces off as it is placed, and an item the store cancels puts them back.
    A returned item is <b>not</b> put back — look at it first, then add it here. A size at
    0 shows as sold out in the shop.`)}
  <div class="adm-bar">
    <span class="t-micro dim">${products.length} products · ${out} ${out === 1 ? 'size' : 'sizes'} sold out ·
      ${few} at ${low} or fewer</span>
    <button type="button" class="btn btn-sm btn-primary" data-act="save-stock" disabled>Save the stock</button>
  </div>
  <div class="inv-list" id="inv-list">
    ${products.map((p) => {
      const cols = ((p.variants && p.variants.colour) || []).map((c) => ({ ...c, ref: c.id }));
      const sizes = ((p.variants && p.variants.size) || []).map((s) => ({ ...s, ref: s.id }));
      return `<section class="panel inv-card${p.hidden ? ' is-hidden' : ''}" data-inv="${esc(p.id)}">
        <div class="inv-head">
          <span class="inv-thumb">${(p.img || []).length ? art(p, 0) : ''}</span>
          <div><a href="#/catalogue?p=${encodeURIComponent(p.id)}" class="pm-name">${esc(p.name)}</a>
            <div class="t-micro dim">${D.fmtInt(p.stock || 0)} ${p.stock === 1 ? 'piece' : 'pieces'}${p.hidden ? ' · hidden from the shop' : ''}</div></div>
        </div>
        ${stockTable(cols, sizes, (cr, sr) => Number((p.skus || {})[keyOf(cols.length ? cr : '', sizes.length ? sr : '')]) || 0, 'inv')}
      </section>`;
    }).join('')}
  </div>
  <div class="adm-save">
    <button type="button" class="btn btn-primary" data-act="save-stock" disabled>Save the stock</button>
    <span class="t-micro dim" data-stock-said></span>
  </div>`;
}

function wireInventory(host, repaint, query = {}) {
  const list = $('#inv-list', host);
  if (!list) return;
  stockHost = list;
  const buttons = $$('[data-act="save-stock"]', host);
  const said1 = $('[data-stock-said]', host);
  const changed = () => $$('[data-inv-cell]', list).filter((i) => i.value !== i.dataset.was);
  const paint = () => {
    const n = changed().length;
    for (const b of buttons) {
      b.disabled = !n;
      b.textContent = n ? `Save the stock (${n} ${n === 1 ? 'change' : 'changes'})` : 'Save the stock';
    }
    if (said1) said1.textContent = n ? 'Not saved yet.' : '';
  };
  list.addEventListener('input', (e) => {
    const i = e.target.closest('[data-inv-cell]');
    if (!i) return;
    i.classList.toggle('is-changed', i.value !== i.dataset.was);
    i.classList.toggle('is-out', whole(i.value) === 0);
    paint();
  });
  // From a product's "Stock" button: straight to it, marked.
  const at = query.p && list.querySelector(`[data-inv="${CSS.escape(query.p)}"]`);
  if (at) { at.classList.add('is-here'); at.scrollIntoView({ block: 'start' }); }

  for (const b of buttons) {
    b.addEventListener('click', async () => {
      const boxes = changed();
      if (!boxes.length) return;
      const wrong = boxes.find((i) => Number.isNaN(whole(i.value)) || whole(i.value) > 100000);
      if (wrong) { toast('Stock must be whole numbers, 0 or more.'); wrong.focus(); return; }
      const byProduct = new Map();
      for (const i of boxes) {
        const pid = i.closest('[data-inv]').dataset.inv;
        const [cr, sr] = i.dataset.invCell.split('|');
        const k = keyOf(cr, sr);
        if (!byProduct.has(pid)) byProduct.set(pid, {});
        byProduct.get(pid)[k] = [whole(i.dataset.was), whole(i.value)];
      }
      for (const x of buttons) x.disabled = true;
      let n = 0;
      try {
        for (const [pid, changes] of byProduct) {
          await store.catalogAdmin.setStock(pid, changes);
          n += 1;
        }
        // Saved: what the boxes show is now what they were drawn with.
        for (const i of boxes) i.dataset.was = i.value;
        toast(`Stock saved for ${n} ${n === 1 ? 'product' : 'products'}.`);
        repaint();
      } catch (e) {
        toast(`${said(e)}${n ? ` (${n} saved before this one)` : ''}`);
        paint();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// WIRING
// ---------------------------------------------------------------------------
export function wireCatalogTab(tab, host, ctx, repaint) {
  if (tab === 'catalogue') {
    const search = $('#adm-q', host);
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim();
        try {
          const url = '#/catalogue' + (q ? '?q=' + encodeURIComponent(q) : '');
          if (location.hash !== url) history.replaceState(null, '', url);
        } catch { /* file:// -- the filter below is what matters */ }
        const needle = q.toLowerCase();
        for (const row of $$('[data-row]', host)) {
          row.hidden = needle ? !row.textContent.toLowerCase().includes(needle) : false;
        }
      });
      if (search.value) search.dispatchEvent(new Event('input'));
    }
    for (const b of $$('[data-price]', host)) {
      b.addEventListener('click', () => {
        const p = ctx.products.find((x) => x.id === b.dataset.price);
        if (p) changePrice(p, repaint);
      });
    }
    wireEditor(host, repaint);
  } else if (tab === 'inventory') {
    wireInventory(host, repaint, ctx.query || {});
  }
}
