// ============================================================================
// DEVI Collections — the procedural artwork engine.
//
// There are no product photographs. Rather than ship grey boxes or depend on a
// stock-photo host that Zscaler may block, every product gets a distinct piece
// of generated craft artwork, drawn deterministically from its id.
//
// THE GRAMMAR IS REAL. Indian textiles are laid out as zameen (the ground
// field), buta (the repeated motif), pallu (the border band) and selvedge.
// Using the actual craft vocabulary rather than an invented layer stack is
// what stops the output reading as generated noise.
//
// ---------------------------------------------------------------------------
// WHY INLINE SVG AND NOT A CSS background-image
//
// A data-URI SVG is a SEPARATE DOCUMENT and cannot read the host page's CSS
// custom properties. Every colour would have to be a literal hex inside a
// component rule — which tokens.pl fails on, and rightly, because those
// colours could never follow the theme. Inline SVG resolves
// fill="var(--p-sand)" against the page's :root for free.
//
// Static .svg files were the other option: 54 products × 4 views = 216 files,
// and something has to generate them. There is no build step on this machine.
//
// ---------------------------------------------------------------------------
// ⚠️ SVG ids ARE DOCUMENT-GLOBAL. If two cards both emit <pattern id="bagru">,
// the second card's fill="url(#bagru)" silently resolves to the FIRST
// definition and the whole grid paints with one motif. Every generated id is
// therefore suffixed with the product id and the view. This bug is invisible
// on the detail page, where there is one product, and glaring on a grid.
//
// ⚠️ GOLD IS A FILL, NEVER A STROKE. --art-gold measures 2.43–2.65 against the
// pastel grounds and fails 3:1. It is not fixed by darkening it; it is fixed
// by giving every gold shape an --art-ink outline (4.11), so the shape's edge
// carries the contrast. That is also how real zari and khari block-printing
// physically looks: metallic fill inside a printed outline. The accessibility
// fix and the craft authenticity are the same decision.
//
// No literal colours anywhere in this file. tools/art.pl checks it.
// ============================================================================

const W = 400, H = 500;              // the 4:5 tile every view is drawn on
const PASTELS = ['--p-blush','--p-sage','--p-sky','--p-sand','--p-lilac','--p-clay'];

// ---------------------------------------------------------------------------
// SEEDING — FNV-1a 32-bit with a salted stream per axis.
//
// Salting rather than slicing one hash into bitfields is about AXIS COUNT:
// 32 bits in 8-bit slices gives four axes and this system needs nine. At the
// fifth axis you start reusing bits and the axes correlate — the motif would
// predict the rotation. Salting costs one string concat and has no ceiling.
// ---------------------------------------------------------------------------
const h32 = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};
const stream = (id, salt) => h32(salt + ':' + id);
const pick   = (id, salt, arr) => arr[stream(id, salt) % arr.length];
const range  = (id, salt, lo, hi) => lo + (stream(id, salt) % 1000) / 1000 * (hi - lo);
const gate   = (id, salt, pct) => (stream(id, salt) % 100) < pct;

// An id safe to put in an SVG id attribute. Prefixed so it never starts with
// a digit, which is invalid for a fragment reference in some engines.
//
// ⚠️ THE TRAILING @@ IS AN INSTANCE PLACEHOLDER, and it is load-bearing.
// Product + view is NOT unique enough. The same product appears in several
// rails on one home page, and the detail page renders view 0 as both the main
// image and its own first thumbnail. Each of those emits the same markup, so
// without a per-insertion counter the document ends up with duplicate ids --
// sixteen of them on the home page, measured, before this was added.
//
// Today the colliding definitions happen to be identical, so it still paints
// correctly. That is exactly what makes it dangerous: the day two renders of
// one product differ, the second silently paints with the first's pattern and
// nothing anywhere looks wrong.
//
// art() swaps @@ for a fresh number on every call, AFTER the memo cache, so
// the expensive part -- nine hash streams and a few KB of markup -- is still
// computed once per product and view.
const uid = (id, view, part) =>
  `dv-${part}-${String(id).replace(/[^a-zA-Z0-9]/g, '')}-v${view}-@@`;

let instance = 0;
const stamp = (svg) => svg.split('@@').join(String(++instance));

// ---------------------------------------------------------------------------
// FIELD MOTIFS — each returns { tile:[w,h], body }.
// patternUnits is always userSpaceOnUse, never objectBoundingBox, so a tile is
// the same physical size on a 240px card and an 800px detail image.
// ---------------------------------------------------------------------------
const MOTIFS = {
  // Bagru block print — four petal wedges around a dot, on a half-drop.
  bagru: (sw) => ({ tile: [40, 40], body: `
    <g fill="none" stroke="var(--art-ink-2)" stroke-width="${sw}" stroke-linejoin="round">
      <circle cx="20" cy="20" r="2.4"/>
      <path d="M20 14.6 C16.4 11, 16.4 5.6, 20 2.6 C23.6 5.6, 23.6 11, 20 14.6 Z"/>
      <path d="M25.4 20 C29 16.4, 34.4 16.4, 37.4 20 C34.4 23.6, 29 23.6, 25.4 20 Z"/>
      <path d="M20 25.4 C23.6 29, 23.6 34.4, 20 37.4 C16.4 34.4, 16.4 29, 20 25.4 Z"/>
      <path d="M14.6 20 C11 23.6, 5.6 23.6, 2.6 20 C5.6 16.4, 11 16.4, 14.6 20 Z"/>
    </g>` }),

  // Sanganeri — a fine three-petal floral sprig with a stem.
  sanganeri: (sw) => ({ tile: [28, 28], body: `
    <g fill="none" stroke="var(--art-ink-2)" stroke-width="${sw}"
       stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 22 V13"/>
      <path d="M14 13 Q8.4 11.2, 8 5.6 Q13.6 6.4, 14 13 Z"/>
      <path d="M14 13 Q19.6 11.2, 20 5.6 Q14.4 6.4, 14 13 Z"/>
      <path d="M14 18 Q9.6 17.2, 8.4 13.2"/>
      <path d="M14 18 Q18.4 17.2, 19.6 13.2"/>
    </g>` }),

  // Bandhani — a tie-dye ring of six dots around a centre, staggered.
  bandhani: (sw) => ({ tile: [24, 24], body: `
    <g fill="none" stroke="var(--art-ink-2)" stroke-width="${sw}">
      <circle cx="12" cy="12" r="1.1"/>
      <circle cx="12" cy="5.6" r="1.6"/><circle cx="17.5" cy="8.8" r="1.6"/>
      <circle cx="17.5" cy="15.2" r="1.6"/><circle cx="12" cy="18.4" r="1.6"/>
      <circle cx="6.5" cy="15.2" r="1.6"/><circle cx="6.5" cy="8.8" r="1.6"/>
    </g>` }),

  // Buta / paisley — a teardrop with a curled tip, plus an inner offset.
  buta: (sw) => ({ tile: [44, 52], body: `
    <g fill="none" stroke="var(--art-ink-2)" stroke-width="${sw}" stroke-linejoin="round">
      <path d="M22 46 C8 40, 6 24, 14 14 C20 6.4, 32 7.2, 34 16
               C35.6 23, 29.6 26, 26 22.4 C23.6 20, 25.2 16.4, 28 17.2"/>
      <path d="M22 40 C13.6 35.6, 12.4 25.2, 17.2 18.8
               C21 13.6, 28 14, 29.2 19.6" opacity=".62"/>
    </g>` }),

  // Ikat chevron.
  // ⚠️ The ±0.6-unit jitter is seeded, not decorative. Ikat's entire visual
  // signature is the feathered bleed where warp and weft fail to align. Clean
  // chevrons read as Scandinavian, not as ikat.
  ikat: (sw, id) => {
    const j = (n) => (range(id, 'j' + n, -0.6, 0.6)).toFixed(2);
    return { tile: [36, 18], body: `
    <g fill="none" stroke="var(--art-ink-2)" stroke-width="${(sw * 1.5).toFixed(2)}"
       stroke-linecap="round" stroke-linejoin="round">
      <polyline points="0,${13 + +j(1)} 9,${4 + +j(2)} 18,${13 + +j(3)} 27,${4 + +j(4)} 36,${13 + +j(5)}"/>
      <polyline points="0,${18 + +j(6)} 9,${9 + +j(7)} 18,${18 + +j(8)} 27,${9 + +j(9)} 36,${18 + +j(10)}"
                opacity=".5"/>
    </g>` };
  },

  // Lehariya — the diagonal wave stripe.
  lehariya: (sw) => ({ tile: [48, 48], body: `
    <g fill="none" stroke="var(--art-ink-2)" stroke-width="${(sw * 1.4).toFixed(2)}"
       stroke-linecap="round">
      <path d="M-6 54 L54 -6"/><path d="M6 54 L54 6"/>
      <path d="M-6 42 L42 -6"/><path d="M18 54 L54 18"/><path d="M-6 30 L30 -6"/>
    </g>` }),

  // Kantha running stitch. Rows are offset by 2.5 so the stitches never align
  // into a grid, which is what makes hand-stitching read as hand-stitching.
  kantha: (sw) => ({ tile: [30, 12], body: `
    <g fill="none" stroke="var(--art-ink-2)" stroke-width="${(sw * 1.3).toFixed(2)}"
       stroke-linecap="round" stroke-dasharray="5 4">
      <line x1="0" y1="3" x2="30" y2="3"/>
      <line x1="2.5" y1="9" x2="32.5" y2="9"/>
    </g>` }),

  // Jaali — an eight-pointed star lattice, tiled edge to edge so the lattice
  // reads as continuous rather than as separate stamps.
  jaali: (sw) => ({ tile: [32, 32], body: `
    <g fill="none" stroke="var(--art-ink-2)" stroke-width="${sw}" stroke-linejoin="round">
      <rect x="7" y="7" width="18" height="18"/>
      <rect x="7" y="7" width="18" height="18" transform="rotate(45 16 16)"/>
      <circle cx="16" cy="16" r="3.2"/>
    </g>` }),

  // The woven counterpart to ikat — no jitter, because a loom does not wobble.
  chevron: (sw) => ({ tile: [32, 16], body: `
    <g fill="none" stroke="var(--art-ink-2)" stroke-width="${(sw * 1.4).toFixed(2)}"
       stroke-linecap="square" stroke-linejoin="miter">
      <polyline points="0,12 8,4 16,12 24,4 32,12"/>
    </g>` }),
};

// ---------------------------------------------------------------------------
// MEDALLIONS — single, centred, never tiled.
// Gold fills always carry an --art-ink outline; see the file header.
// ---------------------------------------------------------------------------
const rot = (n, path, cx, cy, extra = '') => {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<path d="${path}" transform="rotate(${(i * 360 / n).toFixed(1)} ${cx} ${cy})" ${extra}/>`;
  }
  return out;
};

const MEDALLIONS = {
  mandala: (gold) => `
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.5" opacity=".88">
      ${rot(12, 'M200 196 C190 212, 190 236, 200 250 C210 236, 210 212, 200 196 Z', 200, 250)}
      ${rot(12, 'M200 222 C194 232, 194 244, 200 252 C206 244, 206 232, 200 222 Z', 200, 250)}
      <circle cx="200" cy="250" r="62"/>
      <circle cx="200" cy="250" r="70"/>
      <circle cx="200" cy="250" r="12" ${gold ? 'fill="var(--art-gold)"' : ''}/>
    </g>`,

  lotus: (gold) => `
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.6" opacity=".9">
      ${rot(8, 'M200 182 C184 206, 184 236, 200 258 C216 236, 216 206, 200 182 Z', 200, 258)}
      <path d="M140 272 Q200 296, 260 272" />
      <path d="M152 286 Q200 306, 248 286" opacity=".6"/>
      <circle cx="200" cy="252" r="9" ${gold ? 'fill="var(--art-gold)"' : ''}/>
    </g>`,

  // The monogram's arch at full five-cusp fidelity, hollow.
  jharokha: (gold) => `
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.8" opacity=".9">
      <path d="M136 322 V228 C136 194, 164 172, 200 172 C236 172, 264 194, 264 228 V322"/>
      <path d="M152 322 V232 C152 204, 174 188, 200 188 C226 188, 248 204, 248 232 V322"
            opacity=".55"/>
      <path d="M168 322 V236 C168 222, 176 212, 184 218 C190 204, 210 204, 216 218
               C224 212, 232 222, 232 236 V322" opacity=".8"/>
      <path d="M124 330 H276"/>
      <circle cx="200" cy="246" r="8" ${gold ? 'fill="var(--art-gold)"' : ''}/>
    </g>`,

  diya: (gold) => `
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.7" opacity=".9">
      <path d="M146 268 Q200 252, 254 268 Q244 304, 200 308 Q156 304, 146 268 Z"
            ${gold ? 'fill="var(--art-gold)" fill-opacity=".5"' : ''}/>
      <path d="M200 252 C192 238, 196 222, 204 210 C210 224, 212 240, 200 252 Z"
            ${gold ? 'fill="var(--art-gold)"' : ''}/>
      <path d="M200 196 V182 M166 212 L158 202 M234 212 L242 202" stroke-linecap="round"/>
      <path d="M134 316 H266"/>
    </g>`,
};

// ---------------------------------------------------------------------------
// CATEGORY SILHOUETTES — the highest-value idea in this engine.
//
// The patterned fill is clipped to a per-category path, so the SAME bagru
// print reads as a kurti on a kurti and as a folded bedsheet on a bedsheet.
// One mechanism solves both "distinct per product" and "appropriate to the
// category" at once.
//
// `field`     — may a repeating motif fill it?
// `medallion` — may a centred device sit on it? ('force' = always)
// `detail`    — linework drawn ON TOP of the clipped fill, outside it.
// ---------------------------------------------------------------------------
const SHAPES = {
  folded: {
    path: 'M64 150 Q64 142 72 142 H328 Q336 142 336 150 V370 Q336 378 328 378 H72 Q64 378 64 370 Z',
    field: true, medallion: true, border: 'pallu',
    detail: `<g fill="none" stroke="var(--art-ink)" stroke-width="1.3" opacity=".42">
      <path d="M64 206 H336"/><path d="M64 214 H336" opacity=".5"/>
      <path d="M64 312 H336"/><path d="M64 320 H336" opacity=".5"/></g>`,
  },
  drape: {
    path: 'M68 146 H332 V304 L262 376 H68 Z',
    field: true, medallion: true, border: 'edge',
    // The turned corner shows the reverse of the cloth in the alt colourway.
    detail: `<g fill="none" stroke="var(--art-ink)" stroke-width="1.4" opacity=".5">
      <path d="M332 304 L262 376"/></g>`,
    turn: 'M332 304 V376 H262 Z',
  },
  garment: {
    path: 'M152 132 L118 154 L100 214 L134 228 L142 200 V376 H258 V200 L266 228 L300 214 '
        + 'L282 154 L248 132 C236 152, 164 152, 152 132 Z',
    field: true, medallion: false, border: 'hem',
    detail: `<g fill="none" stroke="var(--art-ink)" stroke-width="1.4" opacity=".55">
      <path d="M152 132 C166 156, 234 156, 248 132"/>
      <path d="M142 200 L134 228 M258 200 L266 228"/>
      <path d="M142 358 H258" opacity=".7"/></g>`,
  },
  vessel: {
    path: 'M200 126 C188 126 182 134 182 144 C182 156 168 164 158 184 '
        + 'C140 220 140 282 158 318 C172 344 176 354 176 366 H224 '
        + 'C224 354 228 344 242 318 C260 282 260 220 242 184 '
        + 'C232 164 218 156 218 144 C218 134 212 126 200 126 Z',
    // A carved object is ONE device, not a repeat. Forced.
    field: false, medallion: 'force', border: 'none',
    detail: `<g fill="none" stroke="var(--art-ink)" stroke-width="1.5" opacity=".6">
      <path d="M182 150 Q200 158, 218 150"/>
      <path d="M160 372 H240 V384 H160 Z"/></g>`,
  },
  stool: {
    path: 'M200 154 L306 196 L200 238 L94 196 Z',
    field: true, medallion: false, border: 'none',
    // Legs are flat linework outside the clip — a patterned leg looks painted,
    // not upholstered.
    detail: `<g fill="var(--art-ink-2)" opacity=".8">
      <path d="M104 202 L118 356 L136 362 L124 208 Z"/>
      <path d="M296 202 L282 356 L264 362 L276 208 Z"/>
      <path d="M194 240 L194 378 L206 378 L206 240 Z" opacity=".55"/>
    </g>
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.4" opacity=".5">
      <path d="M126 290 Q200 312, 274 290"/></g>`,
  },
  bag: {
    path: 'M108 208 H292 L308 374 H92 Z',
    field: true, medallion: true, border: 'edge',
    detail: `<g fill="none" stroke="var(--art-ink)" stroke-width="3" opacity=".85"
       stroke-linecap="round">
      <path d="M150 208 C150 148, 250 148, 250 208"/></g>
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.4" opacity=".45">
      <path d="M92 240 H308"/></g>`,
  },
  pouch: {
    path: 'M88 194 Q88 180 104 180 H296 Q312 180 312 194 V336 Q312 350 296 350 H104 '
        + 'Q88 350 88 336 Z',
    field: true, medallion: false, border: 'edge',
    detail: `<g fill="none" stroke="var(--art-ink)" stroke-width="2"
       stroke-dasharray="4 4" stroke-linecap="round" opacity=".7">
      <path d="M100 200 H300"/></g>
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.6" opacity=".7">
      <circle cx="300" cy="200" r="5"/></g>`,
  },
  // A table runner is the one piece here that is longer than it is wide, so
  // it runs VERTICALLY down the 4:5 tile. Laid across it the band would be
  // 60px of pattern in a 500px frame and read as a stripe, not a runner.
  runner: {
    path: 'M140 120 L200 80 L260 120 V400 L200 440 L140 400 Z',
    field: true, medallion: false, border: 'hem',
    detail: `<g fill="none" stroke="var(--art-ink)" stroke-width="1.4" opacity=".5">
      <path d="M140 120 H260 M140 400 H260"/></g>
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.6" opacity=".6"
       stroke-linecap="round">
      <path d="M176 70 V52 M200 66 V44 M224 70 V52"/>
      <path d="M176 450 V468 M200 454 V476 M224 450 V468"/></g>`,
  },
  envelope: {
    path: 'M78 178 H322 V352 H78 Z',
    field: false, medallion: false, border: 'edge',
    detail: `<g fill="none" stroke="var(--art-ink)" stroke-width="1.6" opacity=".6">
      <path d="M78 178 L200 272 L322 178"/>
      <path d="M78 352 L164 282 M322 352 L236 282" opacity=".6"/></g>`,
  },
};

// Which silhouette and which motif pool a product draws from, keyed by its
// SUBCATEGORY -- or, for a category that has none, by the category itself.
// A table runner never gets a pallu; a razai never gets an ikat chevron.
const BY_GROUP = {
  'bedsheets-single': ['folded', ['sanganeri','bagru','bandhani','jaali']],
  'bedsheets-double': ['folded', ['sanganeri','bagru','bandhani','jaali']],
  'bedcovers-quilts': ['folded', ['bagru','sanganeri','buta','kantha']],
  'dohars-single':    ['drape',  ['bagru','kantha','buta','bandhani']],
  'dohars-double':    ['drape',  ['bagru','kantha','buta','bandhani']],
  'dohars-sets':      ['drape',  ['sanganeri','buta','bandhani','lehariya']],
  'table-runners':    ['runner', ['bagru','kantha','jaali','ikat']],
};

// ---------------------------------------------------------------------------
// BORDERS — the pallu and the selvedge.
// ---------------------------------------------------------------------------
const borderBand = (kind, gold) => {
  const g = gold ? 'var(--art-gold)' : 'var(--art-ink-2)';
  if (kind === 'pallu') return `
    <g opacity=".9">
      <rect x="64" y="332" width="272" height="34" fill="${g}" fill-opacity=".55"/>
      <rect x="64" y="332" width="272" height="34" fill="none"
            stroke="var(--art-ink)" stroke-width=".9"/>
      <g fill="none" stroke="var(--art-ink)" stroke-width="1.2" opacity=".7">
        ${Array.from({ length: 9 }, (_, i) =>
          `<path d="M${82 + i * 30} 358 C${76 + i * 30} 350, ${76 + i * 30} 340, ${82 + i * 30} 336
                   C${88 + i * 30} 340, ${88 + i * 30} 350, ${82 + i * 30} 358 Z"/>`).join('')}
      </g>
    </g>`;
  if (kind === 'hem') return `
    <g opacity=".85">
      <rect x="142" y="338" width="116" height="22" fill="${g}" fill-opacity=".5"/>
      <rect x="142" y="338" width="116" height="22" fill="none"
            stroke="var(--art-ink)" stroke-width=".9"/>
    </g>`;
  if (kind === 'edge') return `
    <g fill="none" stroke="${g}" stroke-width="3" opacity=".75">
      <path d="M100 196 H300" stroke="var(--art-ink)" stroke-width="4.2" opacity=".35"/>
      <path d="M100 196 H300"/>
    </g>`;
  return '';
};

// ---------------------------------------------------------------------------
// THE NINE AXES
//
// Motif + colourway ALONE produced only 56 distinct looks across 120 products,
// with a worst bucket of five sharing one. Rotation, scale and weight are what
// take 56 to 120. They are load-bearing, not polish — dropping them to
// "simplify" puts visually identical twins on the same grid page.
// ---------------------------------------------------------------------------
function axes(id, group) {
  const [shapeKey, pool] = BY_GROUP[group] || ['folded', ['bagru', 'jaali']];
  const shape = SHAPES[shapeKey];

  const ground = pick(id, 'c', PASTELS);
  let alt = pick(id, 'c2', PASTELS);
  if (alt === ground) alt = PASTELS[(PASTELS.indexOf(ground) + 3) % PASTELS.length];

  return {
    shape, shapeKey,
    motif: pick(id, 'm', pool),
    ground, alt,
    rotate: Math.round(range(id, 'r', 0, 360)),
    scale: +range(id, 's', 0.70, 1.30).toFixed(3),
    weight: +range(id, 'w', 1.0, 2.2).toFixed(2),
    medallion: shape.medallion === 'force'
      ? pick(id, 'd', ['mandala', 'lotus', 'jharokha', 'diya'])
      : (shape.medallion && gate(id, 'd', 34)
          ? pick(id, 'd', ['mandala', 'lotus', 'jharokha', 'diya']) : null),
    border: shape.border === 'none' ? 'none'
      : (gate(id, 'b', 72) ? shape.border : 'none'),
    gold: gate(id, 'g', 35),
  };
}

// ---------------------------------------------------------------------------
// RENDER
// view 0 front · 1 fabric zoom · 2 flat-lay · 3 alt colourway
// ---------------------------------------------------------------------------
const cache = new Map();

function build(id, group, view) {
  const a = axes(id, group);
  const ground = view === 3 ? a.alt : a.ground;
  const pid = uid(id, view, 'pat');
  const cid = uid(id, view, 'clip');
  const sid = uid(id, view, 'sh');

  const m = MOTIFS[a.motif](a.weight, id);
  const [tw, th] = m.tile;

  // View 1 is the fabric close-up: the pattern at 2.6x, edge to edge, no clip.
  if (view === 1) {
    const s = (a.scale * 2.6).toFixed(3);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"
   role="img" aria-hidden="true" focusable="false">
  <defs><pattern id="${pid}" patternUnits="userSpaceOnUse"
     width="${tw}" height="${th}"
     patternTransform="rotate(${a.rotate}) scale(${s})">${m.body}</pattern></defs>
  <rect width="${W}" height="${H}" fill="var(${ground})"/>
  <rect width="${W}" height="${H}" fill="url(#${pid})"/>
  ${a.gold ? `<g fill="none" stroke="var(--art-ink)" stroke-width="5" opacity=".2">
      <path d="M0 ${H * 0.72} H${W}"/></g>
    <g fill="none" stroke="var(--art-gold)" stroke-width="3.4">
      <path d="M0 ${H * 0.72} H${W}"/></g>` : ''}
</svg>`;
  }

  const field = a.shape.field
    ? `<rect width="${W}" height="${H}" fill="url(#${pid})" clip-path="url(#${cid})"/>`
    : '';

  const inner = `
  <rect width="${W}" height="${H}" fill="var(${ground})" clip-path="url(#${cid})"/>
  ${field}
  ${a.shape.turn ? `<path d="${a.shape.turn}" fill="var(${a.alt})" opacity=".75"/>
     <path d="${a.shape.turn}" fill="none" stroke="var(--art-ink)" stroke-width="1.2" opacity=".5"/>` : ''}
  ${a.border !== 'none' ? `<g clip-path="url(#${cid})">${borderBand(a.border, a.gold)}</g>` : ''}
  ${a.medallion ? `<g clip-path="url(#${cid})">${MEDALLIONS[a.medallion](a.gold)}</g>` : ''}
  <path d="${a.shape.path}" fill="none" stroke="var(--art-ink)" stroke-width="1.6" opacity=".75"/>
  ${a.shape.detail || ''}`;

  // View 2 is the flat-lay: the same cloth, a different composition.
  if (view === 2) {
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"
   role="img" aria-hidden="true" focusable="false">
  <defs>
    <pattern id="${pid}" patternUnits="userSpaceOnUse" width="${tw}" height="${th}"
       patternTransform="rotate(${a.rotate}) scale(${a.scale})">${m.body}</pattern>
    <clipPath id="${cid}"><path d="${a.shape.path}"/></clipPath>
    <filter id="${sid}" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-opacity=".18"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="var(--art-paper)"/>
  <g transform="rotate(-8 200 250) scale(.88) translate(27 34)" filter="url(#${sid})">
    ${inner}
  </g>
  <g fill="none" stroke="var(--art-ink)" stroke-width="2" opacity=".55" stroke-linecap="round">
    <path d="M318 388 C330 404, 326 424, 312 436"/>
    <path d="M330 384 C344 400, 340 422, 326 434"/>
    <path d="M306 392 C316 408, 312 426, 298 438"/>
  </g>
  <circle cx="86" cy="408" r="13" fill="var(--art-gold)"
          stroke="var(--art-ink)" stroke-width="1.2"/>
  <circle cx="86" cy="408" r="4.4" fill="var(--art-paper)"/>
</svg>`;
  }

  // Views 0 and 3 — the front, on the pastel ground.
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"
   role="img" aria-hidden="true" focusable="false">
  <defs>
    <pattern id="${pid}" patternUnits="userSpaceOnUse" width="${tw}" height="${th}"
       patternTransform="rotate(${a.rotate}) scale(${a.scale})">${m.body}</pattern>
    <clipPath id="${cid}"><path d="${a.shape.path}"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="var(${view === 3 ? a.ground : a.alt})" opacity=".34"/>
  ${inner}
</svg>`;
}

// ---------------------------------------------------------------------------
// PUBLIC API
//
// ⚠️ THE SWAP PATH. A product may carry an `img` array. img[view] present →
// photograph; absent or null → generated artwork. Per product AND per view, so
// a partial shoot stays coherent: photograph the front, leave the fabric zoom
// generated. `null` in a slot is meaningful — it says "this view stays
// generated". Adding a photograph is a data edit plus a file, never a code
// change.
//
// The tile is aspect-ratio:4/5 locked in CSS and the SVG uses
// preserveAspectRatio="slice" against the <img>'s object-fit:cover, so the two
// crop identically and swapping one for the other shifts nothing.
// ---------------------------------------------------------------------------
export function art(product, view = 0) {
  const src = product.img && product.img[view];
  if (src) {
    return `<img src="${src}" alt="${(product.name || '').replace(/"/g, '&quot;')}"
       loading="lazy" decoding="async">`;
  }
  const key = `${product.id}:${view}`;
  let v = cache.get(key);
  // ⚠️ sub OR cat. A product in a category with no subcategories has no
  // `sub` at all, and an undefined key here silently falls back to the
  // default folded-bedsheet shape -- every table runner drawn as a sheet.
  if (!v) {
    v = build(product.id, product.sub || product.cat, view);
    cache.set(key, v);
  }
  return stamp(v);   // fresh ids per insertion; see uid()
}

// How many views a product actually has: the alt colourway is only drawn when
// the product declares more than one colour.
export function viewCount(product) {
  const colours = product.variants && product.variants.colour;
  return (colours && colours.length > 1) ? 4 : 3;
}

// ---------------------------------------------------------------------------
// CATEGORY TILES — 3:4, one signature motif per category, no silhouette.
// ---------------------------------------------------------------------------
export function categoryArt(cat) {
  const key = `cat:${cat.id}`;
  let v = cache.get(key);
  if (v) return v;

  const id = cat.id;
  const motif = pick(id, 'cm', ['bagru', 'jaali', 'buta', 'sanganeri', 'ikat', 'lehariya']);
  const m = MOTIFS[motif](1.6, id);
  const [tw, th] = m.tile;
  const pid = uid(id, 9, 'cpat');
  const ground = pick(id, 'cc', PASTELS);

  v = `<svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice"
   aria-hidden="true" focusable="false">
  <defs><pattern id="${pid}" patternUnits="userSpaceOnUse" width="${tw}" height="${th}"
     patternTransform="rotate(${Math.round(range(id, 'cr', 0, 360))}) scale(1.15)">${m.body}</pattern></defs>
  <rect width="300" height="400" fill="var(${ground})"/>
  <rect width="300" height="400" fill="url(#${pid})"/>
  <path d="M60 300 V150 C60 112, 92 86, 150 86 C208 86, 240 112, 240 150 V300"
        fill="none" stroke="var(--art-ink)" stroke-width="2" opacity=".32"/>
</svg>`;
  cache.set(key, v);
  return stamp(v);
}

// ---------------------------------------------------------------------------
// THE HERO
// Seeded on a fixed string, so it is part of the system rather than a one-off
// asset: re-seeding it is how the hero changes each season.
// ---------------------------------------------------------------------------
export function heroArt(seed = 'devi-hero-aw26') {
  const m = MOTIFS.jaali(1.5);
  const [tw, th] = m.tile;
  const pid = uid(seed, 8, 'hero');
  return stamp(`<svg viewBox="0 0 560 700" preserveAspectRatio="xMidYMid slice"
   aria-hidden="true" focusable="false">
  <defs>
    <pattern id="${pid}" patternUnits="userSpaceOnUse" width="${tw}" height="${th}"
       patternTransform="scale(1.6)">${m.body}</pattern>
    <clipPath id="${pid}-c">
      <path d="M140 620 V300 C140 212, 202 156, 280 156 C358 156, 420 212, 420 300 V620 Z"/>
    </clipPath>
  </defs>
  <rect width="560" height="700" fill="var(--p-sand)"/>
  <rect width="560" height="700" fill="url(#${pid})" opacity=".55"/>
  <rect width="560" height="700" fill="url(#${pid})" clip-path="url(#${pid}-c)"/>
  <path d="M140 620 V300 C140 212, 202 156, 280 156 C358 156, 420 212, 420 300 V620"
        fill="none" stroke="var(--art-ink)" stroke-width="3"/>
  <path d="M168 620 V306 C168 228, 218 182, 280 182 C342 182, 392 228, 392 306 V620"
        fill="none" stroke="var(--art-ink)" stroke-width="1.6" opacity=".5"/>
  <path d="M196 620 V312 C196 282, 212 262, 232 272 C246 244, 314 244, 328 272
           C348 262, 364 282, 364 312 V620"
        fill="none" stroke="var(--art-ink)" stroke-width="1.6" opacity=".7"/>
  <g>${rot(8, 'M280 300 C264 324, 264 354, 280 376 C296 354, 296 324, 280 300 Z', 280, 376)
        .replace(/<path /g, '<path fill="none" stroke="var(--art-ink)" stroke-width="1.6" opacity=".8" ')}</g>
  <circle cx="280" cy="370" r="10" fill="var(--art-gold)"
          stroke="var(--art-ink)" stroke-width="1.2"/>
  <path d="M96 636 H464" stroke="var(--art-ink)" stroke-width="3" stroke-linecap="round"/>
  <path d="M112 652 H448" stroke="var(--art-ink)" stroke-width="1.4"
        stroke-linecap="round" opacity=".5"/>
</svg>`);
}
