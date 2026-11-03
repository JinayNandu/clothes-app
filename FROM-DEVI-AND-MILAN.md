# What to take, from which parent, and what to leave

Two working apps sit beside this folder. Neither is a template; both
are things that were built, broken, and fixed in front of a real owner.
Read the file before copying it — the comments carry the reasons, and a
reason is worth more than the code it sits above.

```
%USERPROFILE%\Projects\devi-collections    the storefront
%USERPROFILE%\Projects\kirana              the database
```

Both are git repositories with full history. `git log` in either is a
record of what went wrong.

---

## Read these first, before copying a line

| | |
|---|---|
| `devi-collections/CLAUDE.md` | The storefront's rules. 765 lines. Variants, the admin overlay, the artwork engine, why there is no login. |
| `kirana/CLAUDE.md` | The database's rules. Row-level security, the SECURITY DEFINER pattern, the two backends behind one facade. |
| `kirana/db/SETUP.md` | **288 lines, step by step, already followed end to end.** Supabase project, auth switches, Brevo SMTP, and making the email carry a six-digit code instead of a magic link. Do not rediscover any of this. |
| `kirana/DEPLOY.md` | GitHub Pages. The root-redirect trap is in here — see below. |
| `kirana/db/MULTISTORE.md` | For the day it is more than one manufacturer. Not day one. |

---

## From DEVI — the storefront

### Take nearly whole

| File | Lines | Why |
|---|---|---|
| `app/domain.js` | 504 | Integer rupees, the IST clock, variant identity, the status machine, the free-shipping threshold measured on items BEFORE the coupon. The single most valuable file in either project. |
| `app/router.js` + `app/app.js` | 106 + 182 | A real URL router. Milan's `show()`/`SCREENS` is a screen stack and does not give you shareable product links — which a clothes shop lives on. |
| `app/components.js` | 195 | Product cards, badges, price blocks. |
| `app/pages/product.js` | 215 | Gallery, variant picker, add to cart. The screen a clothes shop IS. |
| `app/pages/listing.js` | 195 | Category browsing and filters. |
| `app/pages/cart.js` + `checkout.js` | 174 + 200 | Variant-aware cart, coupon, totals. |
| `app/pages/wishlist.js` | — | Pure gain. A grocery has no use for it; a clothes shop does. |
| `app/styles/*.css` | 5 files | `tokens.css` first. One token set, no literal colours in component rules. |
| `app/art.js` | 602 | **Generated artwork for products with no photograph.** Keep it even after real photographs arrive: it is what stops a half-stocked catalogue looking broken. |
| `tools/` | all | `check.pl`, `balance.pl`, `data.pl`, `money.pl`, `tokens.pl`, `canon.pl`, `honesty.pl`, `routes.pl`, `serve.pl`. Perl, because there is no Node here. |

### Take, then change for garments

- **`app/data/catalog.json`** — the SHAPE is right (variants carrying
  `delta`, `swatch` as a literal hex, derived badges). The products are
  bed linen. Replace them; keep the shape and the `note` at the top.
- **`app/data/categories.json`** — same. Note the rule that a product in
  a category with no children carries no `sub` key at all, and `data.pl`
  enforces it both ways.
- **The size axis** — single/double/king becomes S/M/L/XL/XXL. The rule
  that **only the size axis may carry a price delta** holds exactly.
- **`app/pages/admin*.js`** (1113 lines) — the owner editing their own
  catalogue, as a patch set over the JSON rather than a copy of it. Read
  `### It edits a patch set, never a catalogue` before touching it.

### Leave

- `app/handoff.js` and the WhatsApp order handoff — replaced by a real
  database.
- `app/gateway-razorpay.js` — unless the owner already has a Razorpay
  account. Start where Milan is: a UPI QR that takes no money and says
  so. See `kirana/CLAUDE.md`, *Paying — UPI, and no gateway*.
- The bed-linen brand band, artwork palette and `pages.json` copy.

---

## From MILAN — the database and everything around it

### Take nearly whole

| File | Lines | Why |
|---|---|---|
| `db/schema.sql` | 304 | Tables, row-level security, and the SECURITY DEFINER functions a customer is allowed to call. **Read the comments.** `is_staff()` is `security definer` for a reason that is written down, and without it every policy recurses. |
| `db/SETUP.md` | 288 | See above. Follow it; do not improvise. |
| `db/store-code.sql` | 109 | `claim_staff()` — typing a code makes THIS session staff, server-side. How the seller gets into their own admin without an account. |
| `db/order-edit.sql` | 85 | `edit_order()` — the customer changing their own order. The pattern for "a customer may do exactly one thing to their own row". |
| `app/backend-supabase.js` | 737 | The Supabase half of the facade. |
| `app/store.js` | 44 | The facade itself. Picks a backend on whether `config.js` names a project, so the app runs with no credentials at all — which is what lets you test without writing rows into the real database. |
| `app/account.js` | 292 | Anonymous session upgraded with email + six-digit code. |
| `app/lock.js` | 179 | The seller-view gate. Pure, no DOM. |
| `tools/setpin.pl` | — | Sets the seller code. Writes a PBKDF2 hash, never the code. |

### The four rules that make the facade work

Both backends obey these, and breaking one breaks the swap:

1. **Every method is `async`**, even when answered from memory.
2. **Returns are deep-cloned.** No live references out of the store.
3. **Ids are minted by the backend**, never the UI.
4. **`live.subscribe(topic, cb)` returns an unsubscribe function.**

### Leave — all of it grocery

`runplan.json`, `slots.pl`, the run/window state machine, the slot
picker, the load list, `minsToStart`, `isBookable`, `seed.js`, the
tempo route in `parked/`, buy-2-get-1, the pure-veg check, and the
delivery-window language throughout `i18n.js`.

---

## Traps that cost real time in both projects

Each of these was found by something breaking, not by reading.

- ⚠️ **GitHub Pages: `<meta http-equiv="refresh">` cannot carry a query
  string.** The root redirect must be JavaScript:
  `location.replace("./app/" + location.search + location.hash)`.
  Without it `?admin` silently becomes `/app/` and the seller lands in
  the customer view wondering why. This was diagnosed twice.
- ⚠️ **Supabase keeps pgcrypto in the `extensions` schema.** A
  `SECURITY DEFINER` function pins its own `search_path`, so
  `set search_path = public` makes `crypt()` invisible INSIDE the
  function while it works perfectly in the SQL editor. Use
  `public, extensions`.
- ⚠️ **An empty RLS result is indistinguishable from an empty table.**
  A board rendering "No orders yet today" over a shop full of orders
  sent us hunting a bug in the orders rather than in the session. Say
  which it is.
- ⚠️ **Normalise the same string on both paths.** A code that the gate
  lowercases and the server does not is a correct code refused, with
  nothing on screen to explain it.
- ⚠️ **A non-global `s///` in Perl returns 1 whenever it substitutes
  anything**, so a "matched N times" guard built on it guards nothing.
  Count first. This put a feature on the wrong screen.
- ⚠️ **`show()`-style routers gate on a screen list.** A registered
  screen missing from it does nothing and warns to a console nobody
  has open.

---

## Suggested order of work

Each step ends somewhere you can show the owner.

1. **Copy DEVI, strip it to a skeleton, serve it.** One category, three
   products, generated artwork. Walk it on a phone.
2. **Garment catalogue and the size axis**, with a size chart on the
   product page. *This is the screenshot that sells it.*
3. **Cart, coupon, totals** — `money.pl` green.
4. **Checkout, address, place an order** — still local storage. A
   complete order end to end.
5. **The delivery range**, frozen at placement.
6. **Supabase** — follow `kirana/db/SETUP.md`. Orders now leave the
   browser.
7. **Accounts** — Milan's `account.js`, so a parcel can be tracked from
   a second phone.
8. **The seller view**, behind `claim_staff()`.
9. **Returns** — the seven-day clock from `deliveredAt`.
10. **Real photographs**, whenever the owner can supply them.

Steps 1–5 are the demo. 6–10 make it a shop.
