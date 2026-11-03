// ============================================================================
// DEVI Collections — the catalogue overlay. PURE: no DOM, no storage, no clock.
//
// THE PROBLEM THIS SOLVES
//
// The catalogue ships as app/data/catalog.json, reviewed and in version
// control. The admin edits it in a browser. Those two facts fight each other:
// if the browser keeps a whole copy of the catalogue, then the next time the
// shipped file gains a product, fixes a typo or corrects a description, the
// browser's copy silently wins and none of it is ever seen again.
//
// So the browser does NOT keep a catalogue. It keeps a set of FIELD-LEVEL
// PATCHES over the shipped one:
//
//   { rev: 1, patch: { 'p-bc-kalamkari-indigo': { price: 3299 } },
//     added: [ ...whole products... ], retired: [ 'p-xx-yy' ] }
//
// Edit a price and only `price` is patched; every other field still comes from
// the shipped file, so a later catalogue update flows through untouched.
//
// ⚠️ PATCHING IS PER TOP-LEVEL FIELD, which matters for the structured ones.
// Editing one size delta patches the WHOLE `variants` value, so a colour added
// to that product in a later catalog.json will NOT flow through. Scalars
// (price, stock, name, desc) do not have this problem. reconcile() is what
// surfaces it: the field shows up as a conflict rather than being lost.
//
// ⚠️ `rev` IS LOAD-BEARING. It records which shipped catalogue the patches
// were written against. When it stops matching, the patches are NOT applied --
// they are held back for review. A price set against last month's catalogue is
// an opinion about a product that may no longer exist, and quietly applying it
// is how a shop ends up selling something at a number nobody chose.
// ============================================================================

/**
 * Deep key sort. The exported JSON has to match tools/canon.pl BYTE FOR BYTE,
 * and JSON.stringify emits keys in insertion order, so the sort has to happen
 * before stringify rather than being asked of it.
 *
 * Sorting is by UTF-16 code unit here and by codepoint in Perl. Those differ
 * only above the BMP; every key in this project is ASCII, so they agree.
 */
export function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out = {};
    // ⚠️ Integer-like keys would be enumerated numerically first whatever this
    // sort does -- a JavaScript object rule no sort can override. Every key
    // here is an identifier, so it does not arise; a numeric key would have to
    // become a Map.
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

/**
 * The exact form tools/canon.pl checks for: keys sorted, two-space indent,
 * one trailing newline. canon.pl's JSON::PP is configured to match this, and
 * the admin asserts the pairing at runtime rather than trusting it.
 */
export const canonicalJSON = (v) => JSON.stringify(sortDeep(v), null, 2) + '\n';

/** Structural equality, by canonical form. Enough for JSON data. */
export const sameValue = (a, b) =>
  JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));

/**
 * The same data with every object's keys in reverse order. Exists purely so
 * the canonical self-check has an input that is NOT already sorted.
 *
 * ⚠️ Without this the self-check is worthless and looks fine. The shipped
 * files are already key-sorted, because canon.pl wrote them that way, so
 * JSON.parse hands back sorted keys and re-encoding reproduces the file even
 * if sortDeep() does nothing at all. Measured: a no-sort stringify of the
 * parsed file matches it byte for byte. Reversing first is what makes the
 * check able to fail.
 */
export function reverseKeys(v) {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).reverse()) out[k] = reverseKeys(v[k]);
    return out;
  }
  return v;
}

export const emptyOverlay = (rev) =>
  ({ rev, at: null, patch: {}, added: [], retired: [], catPatch: {} });

/** Every field the admin may patch. Anything else is structural, or derived. */
export const EDITABLE = [
  'name', 'slug', 'shortDesc', 'desc', 'price', 'mrp', 'stock', 'popularity',
  'shipClass', 'kind', 'cat', 'sub', 'addedOn', 'badges', 'tags', 'specs',
  'variants', 'img',
];

/** Numbers that must stay whole rupees, and whole counts. */
export const INTEGER_FIELDS = ['price', 'mrp', 'stock', 'popularity'];

export function countEdits(ov) {
  if (!ov) return 0;
  const f = Object.values(ov.patch || {}).reduce((n, x) => n + Object.keys(x).length, 0);
  const c = Object.values(ov.catPatch || {}).reduce((n, x) => n + Object.keys(x).length, 0);
  return f + c + (ov.added || []).length + (ov.retired || []).length;
}

/**
 * 'none'    nothing has been edited in this browser
 * 'current' patches were written against the catalogue that is loaded
 * 'stale'   the shipped catalogue has moved on -- hold them back, review them
 */
export function overlayState(shippedRev, ov) {
  if (!ov || countEdits(ov) === 0) return 'none';
  return ov.rev === shippedRev ? 'current' : 'stale';
}

/** Shipped products + patches -> what the shop should actually show. */
export function applyOverlay(products, ov) {
  if (!ov) return products;
  const patch = ov.patch || {};
  const retired = new Set(ov.retired || []);
  const out = [];
  for (const p of products) {
    if (retired.has(p.id)) continue;
    const f = patch[p.id];
    if (!f) { out.push(p); continue; }
    const merged = { ...p, ...f };
    // ⚠️ null means UNSET, not "the value null". It is how the admin moves
    // a product into a category that has no subcategories: `sub` has to
    // become ABSENT. data.pl tests `defined`, and no shipped file ever
    // carries a key with nothing in it, so an exported `"sub": null` would
    // be a third spelling of "no subcategory" that nothing else reads.
    for (const k of Object.keys(f)) if (f[k] === null) delete merged[k];
    out.push(merged);
  }
  for (const p of ov.added || []) {
    if (retired.has(p.id)) continue;
    // A shipped product with the same id wins: the catalogue caught up with
    // something added here, and the reviewed copy is the real one.
    if (products.some((q) => q.id === p.id)) continue;
    out.push(p);
  }
  return out;
}

/** The same, for the category tree. A patched `sub` list replaces the whole list. */
export function applyCatOverlay(cats, ov) {
  const patch = (ov && ov.catPatch) || {};
  if (!Object.keys(patch).length) return cats;
  return cats.map((c) => (patch[c.id] ? { ...c, ...patch[c.id] } : c));
}

/**
 * Only what actually differs. An editor that patched every field it rendered
 * would pin all of them, and no later catalogue update would ever flow through
 * again -- the whole point of a field-level patch, lost to one form submit.
 */
export function fieldDiff(shipped, edited, fields = EDITABLE) {
  const out = {};
  for (const k of fields) {
    if (!(k in edited)) continue;
    if (!sameValue(shipped ? shipped[k] : undefined, edited[k])) out[k] = edited[k];
  }
  return out;
}

/**
 * What a stale overlay would do, field by field, against the catalogue now
 * loaded. `agreed` patches say what the new file already says and can simply
 * be dropped; `conflicts` need a human.
 *
 * `gone` is the case that justifies the whole mechanism: a patch against a
 * product the catalogue no longer has. Applying it silently would resurrect a
 * retired product at a price nobody chose.
 */
export function reconcile(products, ov) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const agreed = [];
  const conflicts = [];
  const gone = [];

  for (const [pid, fields] of Object.entries((ov && ov.patch) || {})) {
    const ship = byId.get(pid);
    if (!ship) { gone.push({ pid, fields }); continue; }
    for (const [k, mine] of Object.entries(fields)) {
      (sameValue(mine, ship[k]) ? agreed : conflicts)
        .push({ pid, name: ship.name, field: k, mine, theirs: ship[k] });
    }
  }
  for (const pid of (ov && ov.retired) || []) {
    if (!byId.has(pid)) agreed.push({ pid, field: 'retired', mine: true, theirs: true });
  }
  for (const p of (ov && ov.added) || []) {
    if (byId.has(p.id)) {
      agreed.push({ pid: p.id, name: p.name, field: 'added', mine: true, theirs: true });
    }
  }
  return { agreed, conflicts, gone };
}

/** Drop every patch the newly shipped catalogue already agrees with. */
export function dropAgreed(ov, agreed) {
  const next = JSON.parse(JSON.stringify(ov));
  for (const a of agreed) {
    if (a.field === 'retired') {
      next.retired = (next.retired || []).filter((id) => id !== a.pid);
    } else if (a.field === 'added') {
      next.added = (next.added || []).filter((p) => p.id !== a.pid);
    } else if (next.patch[a.pid]) {
      delete next.patch[a.pid][a.field];
      if (!Object.keys(next.patch[a.pid]).length) delete next.patch[a.pid];
    }
  }
  return next;
}

/** Build the file that goes back into app/data/catalog.json. */
export function exportCatalog(shipped, products) {
  return {
    note: shipped.note,
    // Bumping rev is what lets the overlay retire itself. Once this file is in
    // place, the patches it contains are agreed by definition: reconcile()
    // finds no conflicts and the admin clears them in one click.
    rev: (Number(shipped.rev) || 0) + 1,
    products: products.slice().sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** The same for categories, so the export covers the whole data edit. */
export function exportCategories(shipped, cats) {
  return { ...shipped, categories: cats };
}
