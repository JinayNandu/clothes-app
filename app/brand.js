// ============================================================================
// Vastra Apparel — the brand mark.
//
// THE IDEA: a V-neckline read as a V. Open a shirt at the collar and the
// shape between the two facings IS a V; set it between two shoulder lines and
// the silhouette is simultaneously the initial of Vastra and the single most
// recognisable detail on a garment. That double reading is what a real mark
// needs — a letter that is also the thing, rather than a garment icon placed
// next to a letter.
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
// ⚠️ THE V APEX MUST SIT ABOVE THE BOTTOM OF THE SIDE SEAMS. At 32.4 it hung
// below them, so the lowest point of the whole mark was the point of the V and
// the eye read the shape bottom-up as an arrow rather than top-down as a
// neckline inside a body. Pulled up to 28.5 against seams that run to 36, and
// the garment reading arrives on its own.
const VEE      = 'M16.4 12.6 L24 28.5 L31.6 12.6';
const SHOULDER = 'M16.4 12.6 L7.2 17.4 M31.6 12.6 L40.8 17.4';

// The topstitch inside the neckline. Dashed, because that is what a topstitch
// IS — and because a second solid V at 24px reads as a printing error.
const STITCH   = 'M20.2 13.4 L24 21.4 L27.8 13.4';

// The side seams dropping away from the shoulders.
//
// ⚠️ DRAWN AT EVERY SIZE, and that is the fix for the first version of this
// mark. With the shoulders and the V alone, the silhouette has two outer
// peaks and a central valley and reads as a crown or a bird — abstract,
// because nothing says which way is down. Two short verticals give the shape
// a body, and the moment it has a body the V is a neckline. Measured on
// screen at 44px, where the crown reading was unmistakable and wrong.
const SEAM     = 'M7.2 17.4 L9.2 36 M40.8 17.4 L38.8 36';

// ---------------------------------------------------------------------------
// The monogram.
//   size >= 44  -> full: topstitch, the gold bar-tack
//   size <  44  -> reduced: no topstitch, no gold, thicker strokes
// ---------------------------------------------------------------------------
export function mark(size = 48) {
  const big = size >= 44;

  const detail = big
    ? `<path d="${STITCH}" fill="none" stroke="currentColor" stroke-width="1"
             stroke-linecap="round" stroke-linejoin="round"
             stroke-dasharray="2.2 2" opacity=".6"/>
       <circle cx="24" cy="31.4" r="1.9" fill="var(--gold)"
               stroke="currentColor" stroke-width=".7"/>`
    : '';

  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}"
     role="img" aria-label="Vastra Apparel" focusable="false">
  <path d="${VEE}" fill="none" stroke="currentColor" stroke-width="${big ? 2.4 : 3.2}"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${SHOULDER}" fill="none" stroke="currentColor"
        stroke-width="${big ? 2.2 : 3}" stroke-linecap="round"/>
  <path d="${SEAM}" fill="none" stroke="currentColor"
        stroke-width="${big ? 1.9 : 2.6}" stroke-linecap="round"
        opacity="${big ? '.75' : '.9'}"/>
  ${detail}
</svg>`;
}

// ---------------------------------------------------------------------------
// The seal — a four-hole button. For the favicon, the order ornament and every
// empty state.
//
// A favicon at 16px cannot carry a neckline: the V and the two shoulders
// collapse into one grey wedge. A button is round, high-contrast and has
// exactly four interior marks, so it survives being drawn at a sixteenth of
// the size it was designed at — and it is still unambiguously clothing.
// ---------------------------------------------------------------------------
export function seal(size = 64) {
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}"
     aria-hidden="true" focusable="false" class="seal">
  <circle cx="24" cy="24" r="20.4" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="24" cy="24" r="14" fill="none" stroke="currentColor"
          stroke-width="1" opacity=".5"/>
  <g fill="currentColor" opacity=".9">
    <circle cx="19" cy="19" r="2.5"/><circle cx="29" cy="19" r="2.5"/>
    <circle cx="19" cy="29" r="2.5"/><circle cx="29" cy="29" r="2.5"/>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// The rule ornament — a hairline with a single stitch at dead centre. Used as
// the section divider throughout. One small SVG, and it does more "this is not
// a template" work than any other single element in the system.
// ---------------------------------------------------------------------------
export function ornament() {
  return `<div class="ornament" aria-hidden="true">
  <svg viewBox="0 0 24 24" width="14" height="14" focusable="false">
    <path d="M12 6.6 L15.4 12 L12 17.4 L8.6 12 Z" fill="currentColor"/>
    <path d="M3.5 12 H6.4 M17.6 12 H20.5" stroke="currentColor" stroke-width="1.4"
          stroke-linecap="round" opacity=".7"/>
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
// connection, converting these two lines to outlines is the fix.
//
// APPAREL is tracked to optically match the VASTRA line's width. Match by
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
  return `<img src="${e(src)}" alt="${e(b.name || 'Vastra Apparel')}">`;
}

export function logo(size = 'sm') {
  const big = size === 'lg';
  const band = size === 'band';
  const px  = big ? 120 : (band ? 44 : 26);
  return `<span class="logo-lock${big ? ' logo-lg' : ''}${band ? ' logo-band' : ''}">
  <span class="logo-mark">${mark(px)}</span>
  <span class="logo-words">
    <span class="logo-name">VASTRA</span>
    <span class="logo-rule" aria-hidden="true"></span>
    <span class="logo-coll">APPAREL</span>
  </span>
</span>`;
}
