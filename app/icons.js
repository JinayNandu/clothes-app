// ============================================================================
// DEVI Collections — icons.
//
// Stroked line art on a 24x24 grid, never filled glyphs and never a little
// scene. Everything inherits currentColor, so a glyph is coloured by whatever
// token its container sets and needs no second definition.
//
// ⚠️ NO EMOJI ANYWHERE IN THIS PROJECT. Emoji are filled, OS-drawn glyphs that
// would collide with the stroked language of everything else, and they render
// differently on every platform the site is viewed on.
// ============================================================================

const P = {
  // interface
  search:  'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4.2-4.2',
  bag:     'M6 8h12l1 12H5L6 8ZM9 8V6a3 3 0 0 1 6 0v2',
  heart:   'M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7-1.2c0 4.8-7 13.2-7 13.2Z',
  user:    'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-3.9 3.6-6 8-6s8 2.1 8 6',
  menu:    'M4 7h16M4 12h16M4 17h16',
  close:   'M6 6l12 12M18 6L6 18',
  chevron: 'M9 5l7 7-7 7',
  up:      'M5 15l7-7 7 7',
  down:    'M5 9l7 7 7-7',
  left:    'M15 5l-7 7 7 7',
  plus:    'M12 5v14M5 12h14',
  minus:   'M5 12h14',
  check:   'M4 12.5l5.5 5.5L20 7',
  info:    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 7.6v.1',
  warn:    'M12 3.5 1.8 20.5h20.4L12 3.5ZM12 10v4.5M12 17.6v.1',
  filter:  'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  copy:    'M9 9h10v12H9V9ZM5 15V3h10',
  phone:   'M6 3h3.5l2 5-2.5 1.5a11 11 0 0 0 5.5 5.5L16 12.5l5 2V18a3 3 0 0 1-3 3A15 15 0 0 1 3 6a3 3 0 0 1 3-3Z',
  mail:    'M3 6h18v12H3V6ZM3 7l9 6 9-6',
  chat:    'M4 5h16v11H9l-5 4V5Z',
  truck:   'M2 7h11v9H2V7ZM13 10h4l3 3v3h-7v-6M6 19.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2ZM17 19.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z',
  shield:  'M12 3l8 3v6c0 4.4-3.4 7.6-8 9-4.6-1.4-8-4.6-8-9V6l8-3Z',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 3v5h-5',
  trash:   'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13',
  grid:    'M4 4h7v7H4V4ZM13 4h7v7h-7V4ZM4 13h7v7H4v-7ZM13 13h7v7h-7v-7Z',
  // category glyphs -- the sidebar and the footer
  bed:     'M3 18v-8h18v8M3 14h18M6 10V7h5v3',
  vase:    'M9 3h6v2c0 2 3 3.5 3 8s-3 8-6 8-6-3.5-6-8 3-6 3-8V3Z',
  kurti:   'M9 3 6 5l-1 5 3 1v10h8V11l3-1-1-5-3-2c-1 1.6-5 1.6-6 0Z',
  stool:   'M12 4 21 8l-9 4-9-4 9-4ZM5 10l1.5 10M19 10l-1.5 10',
  gift:    'M3 9h18v4H3V9ZM4 13h16v8H4v-8ZM12 9v12M12 9C9 9 7 8 7 6.2A2.2 2.2 0 0 1 12 6a2.2 2.2 0 0 1 5 .2C17 8 15 9 12 9Z',
  // Quilting lines, not a window: the outer rect plus a cross of stitching.
  quilt:   'M4 6h16v13H4V6ZM4 12.5h16M10 6v13M16 6v13',
  // Three layers of soft cloth. A dohar is defined by its layers.
  dohar:   'M3 8.5c3-2 6-2 9 0s6 2 9 0M3 13.5c3-2 6-2 9 0s6 2 9 0M3 18.5c3-2 6-2 9 0s6 2 9 0',
  // The mitred point at each end is what makes it a runner and not a strip.
  runner:  'M6.5 7h11l3 5-3 5h-11l-3-5 3-5ZM9 12h6',
};

/** A stroked glyph at `size`, inheriting currentColor. */
export function icon(name, size = 20, extra = '') {
  const d = P[name];
  if (!d) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
   stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
   stroke-linejoin="round" aria-hidden="true" focusable="false" ${extra}>
  <path d="${d}"/></svg>`;
}

/** The filled heart, for a saved wishlist item. The ONLY filled glyph, because
 *  an outline and a fill is how every shop on earth signals saved/not-saved
 *  and inventing a different language here would help nobody. */
export function heartFilled(size = 20) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"
   fill="currentColor" aria-hidden="true" focusable="false">
  <path d="${P.heart}"/></svg>`;
}
