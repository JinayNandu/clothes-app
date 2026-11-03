// ============================================================================
// DEVI Collections — the category tree, and the same tree inside the drawer.
//
// ⚠️ A GROUP WITH ONE CHILD -- OR NONE -- RENDERS AS A PLAIN LINK, never as a
// disclosure. Bedcovers & Quilts and Table Runners have no children at all;
// they hold their products directly. An expand arrow that reveals a single
// row, or an empty list, reads as a broken menu. Both cases are three lines
// each and they are the easiest thing here to forget.
//
// ⚠️ Expanding is a grid-template-rows 0fr → 1fr transition on a wrapper, not
// a height animation. Animating to height:auto is impossible, and the usual
// workaround (measure scrollHeight in JS) breaks the moment a font loads and
// the content reflows.
// ============================================================================

import { $, $$, esc } from './ui.js';
import * as store from './store.js';
import { icon } from './icons.js';
import { ornament } from './brand.js';

let CATS = null, COUNTS = null, EXPANDED = new Set();

export async function initSidebar() {
  CATS = await store.catalog.categories();
  COUNTS = await store.catalog.counts();
  const saved = await store.ui.get();
  EXPANDED = new Set(saved.expanded || []);
  render();
  document.addEventListener('devi:route', syncActive);
}

// ---------------------------------------------------------------------------
// MARKUP
// ---------------------------------------------------------------------------
function groupHTML(c) {
  // No children: the category IS the leaf, and its link is the category.
  if (!c.sub.length) {
    return `<li class="tree-group" data-cat="${esc(c.id)}">
      <a class="tree-top is-leaf" href="#/c/${esc(c.slug)}"
         data-leaf="${esc(c.id)}">
        ${esc(c.name)}
        <span class="tree-count">${COUNTS[c.id] || 0}</span>
      </a>
    </li>`;
  }

  const single = c.sub.length === 1;

  // The single-child case. A link, not a button; no chevron, no wrapper.
  if (single) {
    const s = c.sub[0];
    return `<li class="tree-group" data-cat="${esc(c.id)}">
      <a class="tree-top is-leaf" href="#/c/${esc(c.slug)}/${esc(s.slug)}"
         data-leaf="${esc(s.id)}">
        ${esc(c.name)}
        <span class="tree-count">${COUNTS[s.id] || 0}</span>
      </a>
    </li>`;
  }

  const open = EXPANDED.has(c.id);
  const kids = c.sub.map((s) => `
    <li data-sub="${esc(s.id)}">
      <a href="#/c/${esc(c.slug)}/${esc(s.slug)}">
        ${esc(s.name)}
        <span class="tree-count">${COUNTS[s.id] || 0}</span>
      </a>
    </li>`).join('');

  return `<li class="tree-group" data-cat="${esc(c.id)}">
    <button type="button" class="tree-top" data-toggle="${esc(c.id)}"
            aria-expanded="${open}" aria-controls="tr-${esc(c.id)}">
      ${esc(c.name)}
      <span class="chev">${icon('chevron', 14)}</span>
    </button>
    <div class="tree-wrap${open ? ' open' : ''}" id="tr-${esc(c.id)}">
      <ul class="tree-sub">
        <li data-sub="__all__">
          <a href="#/c/${esc(c.slug)}">All ${esc(c.name)}
            <span class="tree-count">${COUNTS[c.id] || 0}</span></a>
        </li>
        ${kids}
      </ul>
    </div>
  </li>`;
}

function treeHTML() {
  return `<div class="t-eyebrow tree-head">Shop by category</div>
    <ul>${CATS.map(groupHTML).join('')}</ul>
    <div style="margin-top:var(--s5)">${ornament()}</div>
    <ul style="margin-top:var(--s4)">
      <li class="tree-group"><a class="tree-top is-leaf" href="#/shop">Shop All</a></li>
      <li class="tree-group"><a class="tree-top is-leaf" href="#/new">New Arrivals</a></li>
      <li class="tree-group"><a class="tree-top is-leaf" href="#/best">Bestsellers</a></li>
    </ul>`;
}

function render() {
  const html = treeHTML();
  const rail = $('#rail');
  if (rail) rail.innerHTML = html;
  const dtree = $('#drawer-tree');
  if (dtree) dtree.innerHTML = html;
  wire();
  syncActive();
}

// ---------------------------------------------------------------------------
// BEHAVIOUR
// ---------------------------------------------------------------------------
function wire() {
  for (const btn of $$('[data-toggle]')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggle;
      const open = !EXPANDED.has(id);
      if (open) EXPANDED.add(id); else EXPANDED.delete(id);
      // Both copies of the tree move together, or the drawer and the rail
      // disagree the moment the viewport crosses 1024px.
      for (const b of $$(`[data-toggle="${id}"]`)) {
        b.setAttribute('aria-expanded', String(open));
        const w = b.parentElement.querySelector('.tree-wrap');
        if (w) w.classList.toggle('open', open);
      }
      store.ui.save({ expanded: Array.from(EXPANDED) });
    });
  }
}

/** The active leaf gets the gold bar, and its parent group opens itself. */
function syncActive() {
  const hash = location.hash.replace(/^#/, '').split('?')[0];
  const m = hash.match(/^\/c\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/);

  for (const li of $$('.tree-sub li')) li.classList.remove('active');
  for (const a of $$('.tree-top.is-leaf')) a.removeAttribute('aria-current');

  if (!m) return;
  const cat = CATS.find((c) => c.slug === m[1]);
  if (!cat) return;

  if (!cat.sub.length) {
    for (const a of $$(`[data-leaf="${cat.id}"]`)) {
      a.setAttribute('aria-current', 'page');
    }
    return;
  }

  if (cat.sub.length === 1) {
    for (const a of $$(`[data-leaf="${cat.sub[0].id}"]`)) {
      a.setAttribute('aria-current', 'page');
    }
    return;
  }

  const subId = m[2] ? (cat.sub.find((s) => s.slug === m[2]) || {}).id : '__all__';
  for (const li of $$(`[data-cat="${cat.id}"] [data-sub="${subId}"]`)) {
    li.classList.add('active');
    const a = li.querySelector('a');
    if (a) a.setAttribute('aria-current', 'page');
  }

  if (!EXPANDED.has(cat.id)) {
    EXPANDED.add(cat.id);
    for (const b of $$(`[data-toggle="${cat.id}"]`)) {
      b.setAttribute('aria-expanded', 'true');
      const w = b.parentElement.querySelector('.tree-wrap');
      if (w) w.classList.add('open');
    }
    store.ui.save({ expanded: Array.from(EXPANDED) });
  }
}
