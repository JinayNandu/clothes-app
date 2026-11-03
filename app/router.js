// ============================================================================
// DEVI Collections — the router.
//
// Hash routing, one document. The URL IS the state, so hashchange IS the back
// button -- which deletes the parked/ownPop history workaround kirana needs
// (ui.js:106-118) to make a phone's back gesture walk a private NAV array.
//
// ⚠️ Why not path routing: tools/serve.pl 404s anything that is not a file on
// disk (serve.pl:78). There is no SPA fallback, so /p/some-slug would break on
// refresh and on every pasted link -- exactly what shareable product URLs are
// for. Adding a fallback means editing a server shared with kirana.
//
// ⚠️ THIS MODULE IMPORTS NO PAGE MODULE. Pages import it and register
// themselves. A circular ES import hands you `undefined` for something that
// looks hoisted and throws at render, and no bracket checker can see it.
// tools/routes.pl greps for it.
// ============================================================================

import { parseRoute, buildHash } from './domain.js';

const SCREENS = {};
let leaving = [];
let current = null;

/** Pages call this at module scope. */
export function registerScreen(name, enter) { SCREENS[name] = enter; }

/**
 * Register a teardown for the screen being entered. A screen that subscribes
 * to `live` and forgets this fires N times after N visits.
 */
export function onLeave(fn) { leaving.push(fn); }

export const route = () => current;

export function go(path, query) {
  const h = typeof path === 'string' && path.startsWith('#')
    ? path : buildHash(path, query);
  if (location.hash === h) { paint(); return; }
  location.hash = h;
}

/** Same screen, no history entry -- for a filter change. */
export function replace(path, query) {
  const h = buildHash(path, query);
  try {
    history.replaceState(null, '', h);
  } catch {
    // ⚠️ A file:// page has an OPAQUE ORIGIN, and replaceState with a URL
    // throws SecurityError there -- which is exactly where the single-file
    // build (tools/mksingle.pl) runs when someone opens it on a phone.
    //
    // Letting that escape would mean paint() is never reached, so changing a
    // sort or a price filter would silently do nothing at all: the URL would
    // not move and the grid would not redraw. Falling back to a hash
    // assignment costs one history entry -- the only thing replaceState was
    // buying us -- and the hashchange listener does the painting.
    if (location.hash !== h) { location.hash = h; return; }
  }
  paint();
}

let painting = false;

async function paint() {
  if (painting) return;
  painting = true;
  try {
    for (const fn of leaving) { try { fn(); } catch (e) { console.error(e); } }
    leaving = [];

    const r = parseRoute(location.hash);
    current = r;

    for (const el of document.querySelectorAll('[data-screen]')) {
      el.hidden = el.dataset.screen !== r.screen;
    }
    const host = document.querySelector(`[data-screen="${r.screen}"]`);
    if (!host) { console.error('[devi] no section for screen', r.screen); return; }

    host.classList.remove('screen');
    void host.offsetWidth;          // restart the enter animation
    host.classList.add('screen');

    const enter = SCREENS[r.screen];
    if (!enter) { console.error('[devi] no screen registered for', r.screen); return; }

    await enter(host, r);
    document.dispatchEvent(new CustomEvent('devi:route', { detail: r }));
  } finally {
    painting = false;
  }
}

export function repaint() { return paint(); }

export function start() {
  window.addEventListener('hashchange', () => {
    paint();
    // A new screen starts at the top. Staying at the old scroll position after
    // following a link is the single most disorienting thing a hash router does.
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
  if (!location.hash) location.replace('#/');
  return paint();
}
