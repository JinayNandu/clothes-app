// ============================================================================
// DEVI Collections — the brand mark.
//
// THE IDEA: a jharokha arch read as a D. A temple window has a flat base and a
// cusped curved top; stand it on its flat side and the silhouette IS a D. So
// the monogram is simultaneously the initial of Devi and an Indian
// architectural motif — the double reading a real mark needs, rather than an
// Indian motif placed next to a letter.
//
// Everything here is inline SVG using currentColor or a var(--token), so the
// mark is coloured by whatever its container sets and needs no second
// definition. No literal colours — tools/art.pl checks this file too.
//
// ⚠️ OPTICAL SIZING: one path cannot serve 24px and 120px. Pretending
// otherwise is why most logos go muddy in a sticky header. There are two
// variants and `mark()` picks between them on size.
// ============================================================================

// Shared geometry, on a 48×48 grid so a 2-unit stroke renders at exactly 1px
// when the mark is drawn at 24px.
const STEM   = 'M11 7.6 H14.6 V40.4 H11 Z';
const BOWL   = 'M14.6 9.2 C32.4 10.6, 32.4 37.4, 14.6 38.8';
const PLINTH = 'M7.6 43 H40.4';

// The cusped inner arch — three lobes, not five. Five is correct for a real
// jharokha and turns to mush below 40px, which is most of where this renders.
const CUSPS = 'M17.2 36.4 V22.8 '
            + 'C17.2 19.6, 19.4 18.2, 21.2 19.8 '
            + 'C22.4 17.0, 25.2 17.0, 26.4 19.8 '
            + 'C28.2 18.2, 30.4 19.6, 30.4 22.8 '
            + 'V36.4';

// One petal, rotated. Petal radius 5.3 — the lotus occupies ~46% of the
// counter width, so it reads as inhabiting the arch rather than filling it.
const PETAL = 'M24 18.4 C21 21.4, 21 25.6, 24 28.4 C27 25.6, 27 21.4, 24 18.4 Z';
const PETAL_SM = 'M24 19.6 C21.6 22.2, 21.6 25.6, 24 27.9 C26.4 25.6, 26.4 22.2, 24 19.6 Z';

const petals = (n, path) => {
  const step = 360 / n;
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<path d="${path}" transform="rotate(${(i * step).toFixed(1)} 24 24)"/>`;
  }
  return out;
};

// ---------------------------------------------------------------------------
// The monogram.
//   size >= 44  -> full: three cusps, five petals, the gold leaf hairline
//   size <  44  -> reduced: no cusps, three petals, thicker strokes, no gold
// ---------------------------------------------------------------------------
export function mark(size = 48) {
  const big = size >= 44;
  const sw  = big ? 1.8 : 2.6;

  const inner = big
    ? `<path d="${CUSPS}" fill="none" stroke="currentColor" stroke-width="1.1"
             stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>
       <path d="M16.6 37.4 C16.6 23.4, 17.4 20.2, 24 17.2 C30.6 20.2, 31.4 23.4, 31.4 37.4"
             fill="none" stroke="var(--gold)" stroke-width=".9" opacity=".9"/>`
    : '';

  const lotus = big
    ? `<g fill="currentColor" opacity=".9">${petals(5, PETAL)}</g>
       <circle cx="24" cy="24" r="1.5" fill="var(--gold)"
               stroke="currentColor" stroke-width=".6"/>`
    : `<g fill="currentColor">${petals(3, PETAL_SM)}</g>`;

  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}"
     role="img" aria-label="DEVI Collections" focusable="false">
  <path d="${STEM}" fill="currentColor"/>
  <path d="${BOWL}" fill="none" stroke="currentColor" stroke-width="${sw}"
        stroke-linecap="round"/>
  ${inner}
  ${lotus}
  <path d="${PLINTH}" stroke="currentColor" stroke-width="${big ? 1.6 : 2.2}"
        stroke-linecap="round"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// The seal — the lotus alone inside a ring, no arch. For the favicon, the
// order ornament and every empty state. A favicon at 16px cannot carry an arch.
// ---------------------------------------------------------------------------
export function seal(size = 64) {
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}"
     aria-hidden="true" focusable="false" class="seal">
  <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <g fill="currentColor" opacity=".85">${petals(8, PETAL)}</g>
  <circle cx="24" cy="24" r="2.2" fill="none" stroke="currentColor" stroke-width="1"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// The rule ornament — a hairline with a lotus bud at dead centre. Used as the
// section divider throughout. One small SVG, and it does more "this is not a
// template" work than any other single element in the system.
// ---------------------------------------------------------------------------
export function ornament() {
  return `<div class="ornament" aria-hidden="true">
  <svg viewBox="0 0 24 24" width="14" height="14" focusable="false">
    <path d="M12 5 C9.2 8, 9.2 13.4, 12 16.6 C14.8 13.4, 14.8 8, 12 5 Z"
          fill="currentColor"/>
    <path d="M12 16.6 V19" stroke="currentColor" stroke-width="1.2"
          stroke-linecap="round"/>
  </svg>
</div>`;
}

// ---------------------------------------------------------------------------
// The lockup.
//
// ⚠️ The wordmark is LIVE TEXT, not outlined paths. That is a trade, made
// knowingly: outlines would not reflow when Cormorant arrives, but live text
// stays selectable, searchable and readable by a screen reader, and it is one
// line rather than a wall of hand-corrected path data that nobody can edit
// later. The reflow is kept small by the Georgia fallback, which is
// metrically close to Cormorant. If the swap is ever visible on a slow
// connection, converting these two lines to outlines is the fix — see
// CLAUDE.md.
//
// COLLECTIONS is tracked to optically match the DEVI line's width. Match by
// adjusting tracking, never by scaling: scaling breaks the stroke-weight
// relationship between the two lines.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// THE BRAND BAND's contents.
//
// `brand.logo` in shop.json replaces the drawn lockup with a real file.
// Empty, as it ships, draws the lockup.
//
// ⚠️ A PATH, never an upload. data.pl checks the file is actually on disk,
// the same rule every product image follows, so a typo is a check failure
// and not a broken image discovered by a customer.
//
// ⚠️ Escaped locally. brand.js must NOT import ui.js for esc(): ui.js
// already imports this module, and the cycle hands one of them an
// undefined export that only throws at render.
// ---------------------------------------------------------------------------
const e = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function brandBand(shop) {
  const b = (shop && shop.brand) || {};
  const src = String(b.logo || '').trim();
  if (!src) return logo('band');
  return `<img src="${e(src)}" alt="${e(b.name || 'DEVI Collections')}">`;
}

export function logo(size = 'sm') {
  const big = size === 'lg';
  const band = size === 'band';
  const px  = big ? 120 : (band ? 44 : 26);
  return `<span class="logo-lock${big ? ' logo-lg' : ''}${band ? ' logo-band' : ''}">
  <span class="logo-mark">${mark(px)}</span>
  <span class="logo-words">
    <span class="logo-devi">DEVI</span>
    <span class="logo-rule" aria-hidden="true"></span>
    <span class="logo-coll">COLLECTIONS</span>
  </span>
</span>`;
}
