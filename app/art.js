// ============================================================================
// Vastra Apparel — the procedural artwork engine.
//
// Products, categories and the hero all carry PHOTOGRAPHS now -- stand-ins
// from Unsplash until the shop's own are taken, every one credited in
// shop.json `photos`. This engine is the FALLBACK: anything without a
// photograph gets a distinct piece of generated craft artwork, drawn
// deterministically from its id, so a missing file is a drawing and never a
// grey box.
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
// GARMENT SILHOUETTES — the highest-value idea in this engine.
//
// The patterned fill is clipped to a per-garment path, so the SAME bagru print
// reads as a shirt on a shirt and as a kurti on a kurti. One mechanism solves
// both "distinct per product" and "appropriate to the garment" at once.
//
// ⚠️ These shapes are the one part of art.js that is NOT inherited from Vastra.
// Vastra sold bed linen, so its pool was `folded`, `drape` and `runner` — a
// kurti drawn by those comes out as a folded bedsheet. Its `garment` shape
// survived the November 2026 narrowing to linen and is the ancestor of `kurti`
// below; the shirt, the dress and the top are new.
//
// `field`     — may a repeating motif fill it?
// `chest`     — may a small centred device sit on the chest? ('force' = always)
// `bands`     — hem and yoke rectangles, in THIS shape's own coordinates.
//               ⚠️ Vastra hardcoded one hem rect for every shape, which was
//               survivable when every shape was a rectangle of cloth. A dress
//               flares from 88px at the waist to 160px at the hem, so a fixed
//               rect either floats inside the skirt or hangs out of it.
// `detail`    — linework drawn ON TOP of the clipped fill, outside it. This is
//               where a garment becomes a specific garment: a collar and a
//               button placket are what say "shirt" at 240px on a grid.
// ---------------------------------------------------------------------------
const SHAPES = {
  // A button-through shirt. Collar, placket, five buttons, cuffs, chest pocket.
  shirt: {
    path: 'M168 140 L146 146 L104 222 L128 238 L150 206 V378 H250 V206 L272 238 '
        + 'L296 222 L254 146 L232 140 C228 154, 172 154, 168 140 Z',
    field: true, chest: false, border: 'hem',
    // ⚠️ The yoke sits just UNDER the shoulder seam, not at chest height. A
    // shirt yoke is the panel across the shoulders; drawn at y=200 it landed
    // level with the chest pocket and read as a belt worn over the shirt.
    // Measured on screen, not reasoned about.
    bands: { hem: [150, 348, 100, 22], yoke: [150, 162, 100, 26] },
    detail: `<g fill="none" stroke="var(--art-ink)" stroke-width="1.5" opacity=".72">
      <path d="M168 140 L200 184 L162 168 Z"/>
      <path d="M232 140 L200 184 L238 168 Z"/>
      <path d="M192 180 V378 M208 180 V378"/>
      <path d="M110 230 L134 246" opacity=".6"/>
      <path d="M266 246 L290 230" opacity=".6"/>
      <path d="M160 214 H186 V243 L173 251 L160 243 Z" opacity=".6"/></g>
    <g fill="var(--art-ink)" opacity=".8">
      <circle cx="200" cy="216" r="3.1"/><circle cx="200" cy="250" r="3.1"/>
      <circle cx="200" cy="284" r="3.1"/><circle cx="200" cy="318" r="3.1"/>
      <circle cx="200" cy="352" r="3.1"/></g>`,
  },

  // A straight kurti — calf length, side slits, short front placket.
  // The ancestor of this path is Vastra's `garment`, lengthened at the hem.
  kurti: {
    path: 'M152 132 L118 154 L100 214 L134 228 L142 200 V400 H258 V200 L266 228 '
        + 'L300 214 L282 154 L248 132 C236 152, 164 152, 152 132 Z',
    field: true, chest: true, border: 'hem',
    bands: { hem: [142, 368, 116, 24], yoke: [142, 196, 116, 26] },
    detail: `<g fill="none" stroke="var(--art-ink)" stroke-width="1.4" opacity=".6">
      <path d="M152 132 C166 158, 234 158, 248 132"/>
      <path d="M142 200 L134 228 M258 200 L266 228"/>
      <path d="M200 156 V198"/>
      <path d="M142 336 V400" stroke-width="1.7" opacity=".8"/>
      <path d="M258 336 V400" stroke-width="1.7" opacity=".8"/></g>
    <g fill="var(--art-ink)" opacity=".75">
      <circle cx="200" cy="168" r="2.7"/><circle cx="200" cy="188" r="2.7"/></g>`,
  },

  // A tiered A-line midi. Three gathered tiers, so the seams run ACROSS the
  // flare and the widths below are measured on the silhouette, not guessed.
  dress: {
    path: 'M166 136 L148 146 L142 198 L158 208 L156 250 L120 400 H280 L244 250 '
        + 'L242 208 L258 198 L252 146 L234 136 C228 158, 172 158, 166 136 Z',
    field: true, chest: true, border: 'hem',
    bands: { hem: [124, 372, 152, 22], yoke: [156, 214, 88, 24] },
    detail: `<g fill="none" stroke="var(--art-ink)" stroke-width="1.4" opacity=".62">
      <path d="M166 136 C178 160, 222 160, 234 136"/>
      <path d="M156 250 Q200 262, 244 250" stroke-width="1.7"/>
      <path d="M140 318 Q200 330, 260 318"/>
      <path d="M130 360 Q200 372, 270 360"/></g>
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.1" opacity=".4"
       stroke-linecap="round">
      <path d="M164 256 V268 M186 258 V270 M214 258 V270 M236 256 V268"/>
      <path d="M150 324 V336 M180 328 V340 M220 328 V340 M250 324 V336"/></g>`,
  },

  // A boxy top — the same grammar, stopped at the hip. Not in the three-product
  // skeleton; kept live because `women-tops` is the next subcategory to land and
  // a shape added later is a shape nobody checks against the others.
  top: {
    path: 'M160 138 L130 156 L112 212 L140 226 L148 198 V330 H252 V198 L260 226 '
        + 'L288 212 L270 156 L240 138 C232 158, 168 158, 160 138 Z',
    field: true, chest: true, border: 'yoke',
    bands: { hem: [148, 302, 104, 20], yoke: [148, 194, 104, 26] },
    detail: `<g fill="none" stroke="var(--art-ink)" stroke-width="1.4" opacity=".6">
      <path d="M160 138 C172 162, 228 162, 240 138"/>
      <path d="M148 198 L140 226 M252 198 L260 226"/>
      <path d="M148 314 H252" opacity=".7"/></g>`,
  },
};

// Which silhouette and which motif pool a product draws from, keyed by its
// SUBCATEGORY -- or, for a category that has none, by the category itself.
//
// ⚠️ THE POOLS ARE NOT INTERCHANGEABLE. A men's shirt never gets a floral
// buti or a bandhani tie-dye: it gets the woven and geometric prints that
// actually go on shirting. This is the same decision as Vastra's "a razai never
// gets an ikat chevron", and it is what stops the grid reading as one print
// sprayed over four garments.
const BY_GROUP = {
  'men-shirts':    ['shirt', ['chevron', 'jaali', 'ikat', 'kantha']],
  'women-kurtis':  ['kurti', ['bagru', 'sanganeri', 'buta', 'bandhani']],
  'women-dresses': ['dress', ['sanganeri', 'buta', 'bagru', 'lehariya']],
  'women-tops':    ['top',   ['jaali', 'chevron', 'bandhani', 'kantha']],
};

// ---------------------------------------------------------------------------
// CHEST DEVICES — a single embroidered motif at the neck, never tiled.
//
// Vastra's MEDALLIONS were centred at (200,250) with an outer radius of 70, on
// a bedsheet 272px wide. A kurti body is 116px wide, so the same device would
// be clipped to a band across its middle and read as a mistake rather than as
// embroidery. These are the same four ideas at garment scale: ~60px across,
// sitting high on the chest where a real neck motif goes.
//
// Gold fills always carry an --art-ink outline; see the file header.
// ---------------------------------------------------------------------------
const rot = (n, path, cx, cy, extra = '') => {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<path d="${path}" transform="rotate(${(i * 360 / n).toFixed(1)} ${cx} ${cy})" ${extra}/>`;
  }
  return out;
};

const CHEST = {
  buti: (gold) => `
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.25" opacity=".88">
      ${rot(6, 'M200 212 C195.5 221, 195.5 233, 200 240 C204.5 233, 204.5 221, 200 212 Z', 200, 240)}
      <circle cx="200" cy="240" r="3.6" ${gold ? 'fill="var(--art-gold)"' : ''}/>
    </g>`,

  lotus: (gold) => `
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.3" opacity=".9">
      ${rot(5, 'M200 206 C193 219, 193 234, 200 244 C207 234, 207 219, 200 206 Z', 200, 244)}
      <path d="M176 250 Q200 261, 224 250"/>
      <circle cx="200" cy="241" r="3.2" ${gold ? 'fill="var(--art-gold)"' : ''}/>
    </g>`,

  // A jaali fret, squared off — the one device that suits a shirt if a shirt
  // ever opts in, because it is architectural rather than floral.
  jaali: (gold) => `
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.3" opacity=".85">
      <rect x="183" y="215" width="34" height="34"/>
      <rect x="183" y="215" width="34" height="34" transform="rotate(45 200 232)"/>
      <circle cx="200" cy="232" r="5.4" ${gold ? 'fill="var(--art-gold)"' : ''}/>
    </g>`,

  // A keyhole neck tie — two cords and a tassel. Not ornament: it is the most
  // common finish on a kurti neckline in this price band.
  keyhole: (gold) => `
    <g fill="none" stroke="var(--art-ink)" stroke-width="1.4" opacity=".85"
       stroke-linecap="round">
      <path d="M200 200 V224 C200 232, 193 236, 193 244 C193 250, 207 250, 207 244
               C207 236, 200 232, 200 224"/>
      <path d="M186 206 Q200 214, 214 206"/>
      <circle cx="200" cy="252" r="3.4" ${gold ? 'fill="var(--art-gold)"' : ''}/>
      <path d="M197 256 V264 M200 257 V266 M203 256 V264" opacity=".7"/>
    </g>`,
};

// ---------------------------------------------------------------------------
// BANDS — the hem facing and the yoke.
//
// ⚠️ Takes the rect from the SHAPE, never a constant. See `bands` above.
// ---------------------------------------------------------------------------
const borderBand = (kind, gold, bands) => {
  const g = gold ? 'var(--art-gold)' : 'var(--art-ink-2)';
  const r = bands && bands[kind];
  if (!r) return '';
  const [x, y, w, h] = r;
  return `
    <g opacity=".85">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${g}" fill-opacity=".5"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none"
            stroke="var(--art-ink)" stroke-width=".9"/>
      ${kind === 'hem' ? `<g fill="none" stroke="var(--art-ink)" stroke-width="1"
         opacity=".55" stroke-dasharray="4 3">
        <path d="M${x} ${y + h - 5} H${x + w}"/></g>` : ''}
    </g>`;
};

// ---------------------------------------------------------------------------
// THE NINE AXES
//
// Motif + colourway ALONE produced only 56 distinct looks across 120 products,
// with a worst bucket of five sharing one. Rotation, scale and weight are what
// take 56 to 120. They are load-bearing, not polish — dropping them to
// "simplify" puts visually identical twins on the same grid page.
// ---------------------------------------------------------------------------
const CHEST_POOL = ['buti', 'lotus', 'jaali', 'keyhole'];

function axes(id, group) {
  // ⚠️ The fallback is `kurti`, not `shirt`. An unknown group means a
  // subcategory this table has not been taught yet, and a kurti silhouette is
  // the one that reads least wrong on an unknown womenswear garment — which is
  // what a new subcategory here is most likely to be. Vastra's equivalent
  // fallback was a folded bedsheet, and it is exactly what drew every table
  // runner as a sheet until the `sub || cat` bug was found.
  const [shapeKey, pool] = BY_GROUP[group] || ['kurti', ['bagru', 'jaali']];
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
    chest: shape.chest === 'force'
      ? pick(id, 'd', CHEST_POOL)
      : (shape.chest && gate(id, 'd', 34) ? pick(id, 'd', CHEST_POOL) : null),
    // Which band, as well as whether — the hem and the yoke are both real
    // finishes and alternating them is a cheap ninth axis. A shape that
    // declares one band still only ever draws that one.
    border: shape.border === 'none' ? 'none'
      : (gate(id, 'b', 72)
          ? (gate(id, 'bk', 30) && shape.bands.yoke ? 'yoke' : shape.border)
          : 'none'),
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
  ${a.border !== 'none' ? `<g clip-path="url(#${cid})">${borderBand(a.border, a.gold, a.shape.bands)}</g>` : ''}
  ${a.chest ? `<g clip-path="url(#${cid})">${CHEST[a.chest](a.gold)}</g>` : ''}
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

// How many views a product has. A photographed product shows exactly the
// photographs it carries -- a fourth thumbnail drawn in a different style
// beside three photographs reads as a mistake. Otherwise the alt colourway
// is only drawn when the product declares more than one colour.
export function viewCount(product) {
  if (Array.isArray(product.img) && product.img.length) return product.img.length;
  const colours = product.variants && product.variants.colour;
  return (colours && colours.length > 1) ? 4 : 3;
}

// ---------------------------------------------------------------------------
// CATEGORY TILES — 3:4, one signature motif per category, no silhouette.
// ---------------------------------------------------------------------------
// One photograph, the same markup everywhere. `eager` is for the one image a
// page opens on: lazy-loading the hero only delays the first thing seen.
const photo = (src, alt, eager = false) =>
  `<img src="${src}" alt="${String(alt || '').replace(/"/g, '&quot;')}" `
  + `${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;

export function categoryArt(cat) {
  if (cat.img) return photo(cat.img, cat.name);
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
  <path d="M122 70 L98 82 L80 134 L105 146 L112 126 V330 H188 V126 L195 146
           L220 134 L202 82 L178 70 C170 88, 130 88, 122 70 Z"
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
// A kurta on a hanger on a rail. Vastra's hero was a jharokha arch — right for a
// linen brand whose whole language was architectural, and wrong here: the first
// thing a clothes shop must say, in one glance and before any copy is read, is
// that it sells clothes. The hanger is doing most of that work; the garment
// alone reads as a flat pattern swatch.
// `src` is a photograph path from shop.json `hero`; without one the drawn
// hero stands in. Decorative, so no alt text: it is not this shop's floor.
export function heroArt(seed = 'vastra-hero-aw26', src = '') {
  if (src) return photo(src, '', seed === 'vastra-hero-aw26');
  const m = MOTIFS.jaali(1.5);
  const [tw, th] = m.tile;
  const pid = uid(seed, 8, 'hero');
  const BODY = 'M224 150 L180 170 L146 272 L194 294 L206 256 V604 H354 V256 '
             + 'L366 294 L414 272 L380 170 L336 150 C322 180, 238 180, 224 150 Z';
  return stamp(`<svg viewBox="0 0 560 700" preserveAspectRatio="xMidYMid slice"
   aria-hidden="true" focusable="false">
  <defs>
    <pattern id="${pid}" patternUnits="userSpaceOnUse" width="${tw}" height="${th}"
       patternTransform="scale(1.6)">${m.body}</pattern>
    <clipPath id="${pid}-c"><path d="${BODY}"/></clipPath>
  </defs>
  <rect width="560" height="700" fill="var(--p-sand)"/>
  <!-- ⚠️ .26, not DEVI's .55. The same pattern fills the garment at full
       strength, so a strong background leaves the two at nearly equal
       contrast and the silhouette stops being a silhouette — it reads as one
       flat swatch with a hanger drawn on it. Dropped until the garment was
       the thing the eye lands on first. -->
  <rect width="560" height="700" fill="url(#${pid})" opacity=".26"/>
  <path d="M70 92 H490" stroke="var(--art-ink)" stroke-width="5"
        stroke-linecap="round" opacity=".55"/>
  <g fill="none" stroke="var(--art-ink)" stroke-width="4.5"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M280 126 V104 C280 92, 266 87, 258 96"/>
    <path d="M184 170 L280 124 L376 170"/>
  </g>
  <rect width="560" height="700" fill="url(#${pid})" clip-path="url(#${pid}-c)"/>
  <path d="${BODY}" fill="none" stroke="var(--art-ink)" stroke-width="3"/>
  <g clip-path="url(#${pid}-c)">
    <rect x="206" y="556" width="148" height="34" fill="var(--art-gold)"
          fill-opacity=".5"/>
    <rect x="206" y="556" width="148" height="34" fill="none"
          stroke="var(--art-ink)" stroke-width="1.4"/>
  </g>
  <g fill="none" stroke="var(--art-ink)" stroke-width="2.4" opacity=".7">
    <path d="M224 150 C242 184, 318 184, 336 150"/>
    <path d="M206 256 L194 294 M354 256 L366 294"/>
    <path d="M206 470 V604 M354 470 V604" stroke-width="2.8"/>
  </g>
  <g>${rot(6, 'M280 196 C272 214, 272 236, 280 250 C288 236, 288 214, 280 196 Z', 280, 250)
        .replace(/<path /g, '<path fill="none" stroke="var(--art-ink)" stroke-width="2.2" opacity=".8" ')}</g>
  <circle cx="280" cy="250" r="8" fill="var(--art-gold)"
          stroke="var(--art-ink)" stroke-width="1.4"/>
  <path d="M96 648 H464" stroke="var(--art-ink)" stroke-width="3" stroke-linecap="round"/>
  <path d="M112 664 H448" stroke="var(--art-ink)" stroke-width="1.4"
        stroke-linecap="round" opacity=".5"/>
</svg>`);
}
