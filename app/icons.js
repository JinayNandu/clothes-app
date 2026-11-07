// ============================================================================
// Vastra Apparel — icons.
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
  undo:    'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  ruler:   'M3 15.5 15.5 3 21 8.5 8.5 21 3 15.5ZM7 11.5l2 2M10 8.5l1.5 1.5M13 5.5l2 2',
  star:    'M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.6Z',
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
  // ---------------------------------------------------------------------
  // GARMENT GLYPHS -- the sidebar and the footer.
  //
  // Each one is identified by the detail that nothing else has: a shirt by
  // its collar, a kurti by its length and straight side, a dress by its
  // flare. Drawing all three as "a top with sleeves" is how a category menu
  // ends up with three glyphs nobody can tell apart at 20px.
  //
  // There are no glyphs here for anything this shop does not sell. An unused
  // glyph is one somebody reaches for later because it is there, and a razai
  // in a shirt shop is worse than a missing icon.
  // ---------------------------------------------------------------------
  // The collar is the whole glyph. Notch, stand, placket.
  shirt:   'M8.5 3 12 6.5 15.5 3l3.5 2-1 5h-2v11H8V10H6L5 5l3.5-2ZM12 6.5V21',
  // Straight side seams, calf length, side slit. No flare.
  kurti:   'M9 3 6 5l-1 5 3 1v10h8V11l3-1-1-5-3-2c-1 1.6-5 1.6-6 0ZM8 17h8',
  // The flare is the difference. Hem wider than the shoulders.
  dress:   'M9 3 7 5v4l1.5 1.5L5 21h14l-3.5-10.5L17 9V5l-2-2c-1 1.6-5 1.6-6 0Z',
  // The same body, stopped at the hip.
  top:     'M9 3 6 5l-1 5 3 1v5h8v-5l3-1-1-5-3-2c-1 1.6-5 1.6-6 0Z',
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
