# Clothes app — project context

Read this before changing anything. Everything here was either
established by testing or decided deliberately; none of it is a guess.

**Status: steps 1 to 5 of 10 are built — the demo** (4 November 2026). Three
garments, sizes, a bag, and an order that goes from checkout to delivered
-- all of it in one browser until step 6. **Step 6 is connected** (7 November
2026): the live site sends orders to the shop's own Supabase project. **Step 7,
accounts, is built and switched ON** (`SIGN_IN` in `app/config.js`), the same
day, once the owner had set up the email sender and templates (db/SETUP.md
step 7). The owner's own sign-in code **arrived by email**, 7 November 2026 —
the shop's own sender and the code template, working on the real project.
**8 November 2026, on the owner's list:** checkout asks the customer to
**sign in first** and saves their addresses; a **profile page** behind a
person icon on every screen; an **order-details page** with the order's
chain; **Size chart** in words under every card's sizes; and on the store,
a **pop-up** in place of every second tap and **going back a step** —
which needs `schema.sql` run again (db/SETUP.md step 9).
See *Where this is*, *Accounts* and *The order of work*.

---

## What this is

A storefront for a **garment manufacturer who already makes clothes for
brands and has no way to sell them under their own name.** They have the
stock and the designs; what they lack is distribution. This is the
distribution.

The shape is Amazon or Nykaa, not a kirana: a catalogue you browse by
eye, sizes and colours, a cart, an order that arrives in **five to ten
working days**, and **free returns for seven days** after it lands.

Personal side-venture of the user, not client work.

### ⚠️ A separate project from DEVI — the owner's instruction, 4 November 2026

The owner was plain about it: this is a completely different project from
DEVI. Design ideas, a layout, a theme may be taken from it; the project
itself stays separate, with **its own link for customers and its own link
for the store owner**.

- **Ideas, never connections.** A component, a rule learned the hard way, a
  look: yes. A link to DEVI, its storage, its database, its name, its copy
  or its products: never.
- **Two links of its own**: the shop at `…/clothes-app/` and the store at
  `…/clothes-app/store/`. See *Two pages*.
- **Its own storage keys** (`vastra.*`) and, at step 6, **its own Supabase
  project** — not DEVI's and not Milan's.
- **Found and removed the day it was said**, all left over from the copy:
  DEVI's footer blurb (bed linen, "Rajasthan, Bengal and Kerala"), a Gift
  Vouchers link to a category this shop does not have, an "Admin" link in
  every customer's footer, order codes minted as `DC-0001` (DEVI
  Collections' initials), both build outputs named after DEVI, and comments
  that a find-and-replace had turned into "Vastra sold bed linen".
  `routes.pl` now fails on a link to a category or product that does not
  exist, and `honesty.pl` on an order prefix typed into the code.

### Settled with the owner, 4 November 2026

| Question | Answer |
|---|---|
| What do they make? | **Men's shirts, and womenswear across the board** — tops, kurtis, dresses. The skeleton carries one shirt, one kurti, one dress. |
| One manufacturer or several? | **One.** Milan's `db/MULTISTORE.md` is there for the day it is more, and that day is cheaper to reach than to start from. |
| Photographs? | **None of their own yet.** Since 4 November 2026 the site shows Unsplash stand-ins, on the owner's word that the drawn garments looked "too kiddish". `art.js` is now only the fallback. ⚠️ Still the biggest risk to the idea -- see *Open*. |
| How do they pay? | **UPI and cash on delivery.** Both. The UPI id is a demo one that cannot resolve (`@example`). ⚠️ Since 7 November 2026 the checkout no longer SAYS so — the owner shows the site as the flow it will be, and the amber "this QR cannot take money" strip read as a broken shop. The guard is in the data now: `data.pl` fails unless a demo id is on `@example` (an allow-list; it was a deny-list of real handles, which `@okbizaxis` walked past) and fails if `placeholder` goes false while the id is a demo. The Preview bar still calls every order a test. **No card or net banking** since 7 November 2026: both need a gateway (about 2% an order) and a server to verify each payment; they were shown greyed out with "Not set up yet", which read as unfinished. The Razorpay seam stays dormant in `gateway-razorpay.js`. The UPI step asks the customer to keep the payment screenshot and show it to the delivery partner. |

### Still not answered, and each one blocks something

1. ⚠️ **What does a free return actually cost them?** `shop.json` says
   `returns.free: true` and the site promises it on every product page.
   For a manufacturer with no reverse logistics that can mean eating the
   courier both ways on a ₹700 kurti. **The app is making this promise
   on their behalf and nobody has priced it.** Blocks step 9.
2. **Who ships it?** Delhivery, Shiprocket, India Post, a local courier?
   The five-to-ten-day estimate is a planning number, not a quoted
   service level, and the shipping page says so in as many words.
3. **Returns address, GSTIN, and the legal pages.** `contact.returnsAddr`
   is in `shop.json` and `data.pl` requires it to be non-empty before
   `placeholder` can go false. A shop selling to strangers needs it; a
   kirana delivering down the lane did not.

---

## Where this is

| Piece | State |
|---|---|
| Browse — home, category listing, product page, gallery, variant picker | **Built.** Started from a copy of DEVI's code and re-pointed at garments; nothing is shared with DEVI now |
| Cart, coupon, totals | **Built.** `money.pl` green, including the size delta |
| Add to bag, as it feels | **Built, 7 November 2026, on the owner's ask.** A card's Add to bag **asks for a size** (a panel over the photo; each chip names its size and any extra cost), then turns into **− M · n in bag +** for that line; − at one takes it off. A card's colour dots switch its photo and the colour added. A see-through copy of the photo flies into the bag (`ui.js` `flyToBag`) and the bag's count goes up **as it lands**, one per flight, so quick taps read 1, 2, 3. The bag fills with ink once something is in it and says "Bag" from 1024 up. See *Sizes that are garment sizes* for the rule |
| Checkout, address, pay options | **Built.** With the database it places the order. **Since 8 November 2026 it asks the customer to sign in first** — the owner: "how will they ever view that order again" — as step 1, in place on the page (`config.js` `SIGN_IN_TO_ORDER`, a PAGE rule: the server still takes a guest, so one flag brings guest checkout back if codes stop arriving). Signed in: the account's saved addresses as cards, the default first, and "Add a new address", prefilled from the account's name and mobile; a new address is **saved to the account as the order goes through** — no tick box, not twice, not past ten — and the account's name and mobile are kept the first time. UPI or cash on delivery. In one browser, as before: no sign-in, a form, the WhatsApp handoff |
| An order, end to end | **Built (step 4).** Saved → sent by the customer → confirmed, packed, shipped (courier and tracking number optional) and delivered by the store. `deliveredAt` is stamped on delivery. **The order-details page** (8 November 2026, the owner's ask): a way back to Your orders, the code and its pill, then the order's **chain** — Ordered, Confirmed, Packed, Shipped, Delivered, green up to where it is (`components.js` `orderChain`, built from `trackSteps()`) — following the store live; what it says about that; what was bought, **each item opening its product page**; every step with its date; payment; help. **Your orders** shows each order as a card, tapped anywhere (only the code could be tapped before), with its photos, total, delivery range and a small chain. **Stock is not taken off on ordering** — that belongs on the server, where two phones cannot both buy the last one |
| Catalogue | **3 products**, 2 categories, 3 subcategories. Prices and products INVENTED. Photographs are Unsplash stand-ins, credited in `shop.json` `photos` and on the About page |
| Size charts | **Built.** A **Size chart** pop-up from the product page and, since 8 November 2026, from every card's size picker — a full-width line in words under the chips, because the info icon in the panel's corner (words only from 600px) went unseen on a phone. The table opens with one line on how to read it ("Measure your chest, and find it under To fit chest"), plus the no-tap fit hint under the product page's picker |
| Delivery range | **Frozen into the order (step 5)** as it reaches the shop, and read back everywhere after. Live only where it should be: the product page and the shipping page. The store flags an order **Late** once its last promised day has passed |
| Return window | Config and `returnWindow()` exist. **No return flow** — step 9 |
| Store page | **Its own page and link** since 4 November 2026 — `app/owner.html`, opened at `…/clothes-app/store/`, locked by the store code on the server since step 6. Orders with the address, the phone and the next step; catalogue; stock. **Since 7 November 2026, on the owner's word:** the overview counts are in two named groups, *Your orders* and *Your catalogue* (as one row, "3 Products" read as three products ordered); each order's status is the whole road top to bottom, every step ahead a button, and a tap marks it AND every step above it — sent→packed is Confirm then Pack, each in the history (`D.roadTo`), so the customer's timeline goes green to there and the server's one-step road is never skipped; more than one step takes a second tap. "Mark paid" is **"Mark payment received"**, with what to check written beside it (UPI: the amount and the order code in the bank; COD: the courier's cash). **Each item has its own status** (built 7 November 2026, on the owner's yes): a "Move this item to…" menu and Cancel item on every item; the order's status is its slowest item still on its way (`roll_up_order`), rising through every step it passes; cancelling an item takes it out of the total and shrinks the coupon in proportion to `discount_placed`; paid and then cut, the store sees "Refund ₹X" and notes it sent (`mark_refund`), and the customer sees what is owed, then when it went. Needs `schema.sql` re-run — the page hides every per-item control until items carry a status (`D.hasItemStatus`) — and `db/selftest.sql` proves the SQL on the real database and rolls back. **Since 8 November 2026, on the owner's word:** every second tap is a **pop-up that says what will happen** (`ui.js` `askFirst` — never `window.confirm()`, which the artifact viewers answer "no" unseen); a step BEHIND the order is a button as well as every step ahead, plus "Back to <step>", and the order — or one item — goes **back** (see *Each item's own status*); each item's one menu holds Move on, Move back, Cancel this item and Returned (the owner looked for Cancel there), with Cancel item a button beside it too; courier and tracking number are asked in the Shipped pop-up; the overview's "Late" is **Running late**, "None past the delivery date promised to the customer" ("What is 0 late? Late for what?"). Going back needs `schema.sql` run again (db/SETUP.md step 9); until then the board says so. See *Two pages* |
| Database | **Connected (step 6), 7 November 2026**, to the shop's own project: ref `tquymsewhzfawjkyysax`, Mumbai, in an organization of its own (Milan's was full). `db/schema.sql` and `db/store-code.sql` ran clean; the rules were probed from outside. ⚠️ **No order has been placed in it yet**, so `place_order`'s happy path is first exercised by the owner's test order — see *The database* |
| Accounts | **Built and switched on** (7 November 2026) — step 7. Email and a six-digit code, never a password, never required to buy; an address book; a guest's orders follow them into an account. The owner set up Brevo (sender `Vastra Apparel`, a Gmail of the shop's), the switches and both templates; the new SQL ran and its rules were probed from outside. **The first real code arrived by email** (the owner, 7 November 2026), so the sender, SMTP and the code template work. ⚠️ Still unseen: signing in on a SECOND phone, which takes the other template (Magic Link). **8 November 2026:** required at checkout (above), and a **profile page** (`#/account`) behind a person icon in the header on every screen, a phone included — who you are, your orders, saved addresses (signed in with none, the form is already open), your name and mobile (kept on the account, Supabase `user_metadata`), Help and support (the shop's phone, WhatsApp, email, hours, the policy pages) and Settings (wishlist, bag, sign out, clear this browser), after Milan's settings screen. See *Accounts* |
| Brand name and identity | **PLACEHOLDER.** "Vastra Apparel" is invented |
| Public site | Shop <https://jinaynandu.github.io/clothes-app/>, store <https://jinaynandu.github.io/clothes-app/store/> — see *Published*. The shop wears a Preview bar while placeholder is true; the store a Not locked yet bar until step 8 |

### Running it

```bash
perl tools/serve.pl 8150 app
```

**Port 8150**, because 8110/8111 are kirana, 8120 is scorer-dev,
8130–8133 are DEVI and 8140 is orb. `perl tools/serve.pl --lan 8151 app`
for a phone on the same Wi-Fi — opt-in, and it will often fail on a
managed network, which is not a bug in the server.

```bash
perl tools/check.pl        # eleven checks
```

⚠️ **`data.pl` fails on a clean tree, on purpose.** See *Open*.

### Published

**At <https://jinaynandu.github.io/clothes-app/>**, from the `main` branch
of <https://github.com/JinayNandu/clothes-app>. Pages has to be switched on
once: *Settings → Pages → Deploy from a branch → `main` → `/ (root)`*. Same
shape as kirana (`kirana/DEPLOY.md`): Pages serves the repository root, the
root `index.html` forwards into `app/` carrying the query **and the hash**,
and there is no build step on either side.

Product links, for sending to someone — each one goes through the root
redirect, which is why that redirect must keep the hash:
`…/clothes-app/#/p/indigo-dobby-cotton-shirt`,
`…/#/p/bagru-block-print-straight-kurti`, `…/#/p/tiered-cotton-midi-dress`.

**The store has its own link**, `…/clothes-app/store/`. `store/index.html`
is only a door, the same shape as the root one: it forwards to
`app/owner.html` carrying the query and the hash, so `…/store/#/orders`
lands on the Orders tab.

```bash
git add -A && git commit -m "what changed, and why" && git push
```

Pages rebuilds within a minute or two; a phone that already opened the site
can keep the old copy for up to ten minutes.

- **The repository is public** — Pages on a free account requires it.
  Nothing secret is in it; `.claude/` and `PROMPT.md` (the original brief,
  which carries machine paths) are git-ignored and stay on this machine.
- **Commits use the GitHub no-reply address**, set in this repo's
  `.git/config`. History was rewritten on 4 November 2026, before the first
  push, to take a work email, the Windows account name and the brief out of
  it. The pre-rewrite history is `refs/original/refs/heads/master`, local
  only.
- **`tools/deploy.pl` checks the deployed path**, because `serve.pl` serves
  `app/` as the root and so cannot show it: `.nojekyll`, LF endings, both
  redirects keeping `location.hash` (the root one and the store door), the
  store page's `noindex`, no root-relative URL, exact-case paths.
- **The Preview bar** is on every page while `placeholder` is `true` in
  `shop.json`, and goes with it.
- **All of `jinaynandu.github.io` is ONE browser origin.** kirana,
  devi-collections and this shop share `localStorage`. Every key here is
  `vastra.*` (the table at the top of `backend-local.js`), so nothing
  collides today; keep one prefix through any rename, or a visitor's DEVI
  cart turns up in this one.
- **`clothes-as-deployed` (port 8152) serves the repository root as Pages
  does**: the root page, the redirect, the app under `/app/`. Use it for
  anything that touches the redirect. `serve.pl` serves a folder's
  `index.html` for this, taken from kirana's; before that `/app/` was a
  404 locally. The launch entry lives in `Projects/.claude/launch.json`,
  outside this repository.
- **Verified live on 4 November 2026**: all 39 served files byte-identical
  to the repository, modules served as `application/javascript`, and a
  shared product link (`/?ref=whatsapp#/p/...`) arriving at `/app/` with
  its query and hash intact.

---

## The database (step 6)

Its own Supabase project — never Milan's, never DEVI's. Built from
Milan's patterns (`kirana/db/`), with two of Milan's holes closed.

- **Nobody writes a table.** No insert, update or delete grant on any
  table; every write is a SECURITY DEFINER function that checks itself:
  `place_order` (the customer's only write), `advance_order` and
  `set_paid` (staff only), `claim_staff` (the store code). Milan's lets a
  customer INSERT their own order with any status and `paid` they like,
  and its two-insert placement can leave an order with no lines behind.
- **`place_order` re-adds every total** and writes the order and its
  lines in one transaction, sets owner, status `sent`, `paid` false and
  the time itself, caps five orders an hour per session, and rejects a
  delivery promise no rule could produce.
- ⚠️ **It does not know the prices.** The catalogue is JSON in git, not in
  the database, so a hand-made request can name its own unit price and
  coupon. `checkOrderPrices()` flags any such order on the store's board
  ("These are not today's catalogue prices") — proved with a ₹1 shirt.
  **A server-side price check must come before taking money from
  strangers.** See *Open*.
- **The store code is `claim_staff()`**: a bcrypt compare on the server,
  8–24 lowercase characters, five tries an hour per session. The code is
  typed into the SQL editor only; `db.pl` fails if `store-code.sql` holds
  anything but CHANGE-ME. The store page in database mode shows a code
  form, and nothing behind it, until the server says yes.
- **Browsing never touches the server.** A session (anonymous) is made
  when an order is placed, or when the store page opens; its key is
  `vastra.auth`, inside this shop's prefix on the shared origin.
- **`store.js` switches backends with live bindings**, not a top-level
  await, so the single-file build still bundles — and it stays
  one-browser from `file://` whatever the config says.
- **The UI tells the truth in both modes** through `store.shared()`:
  "Save this order" or "Place order", "has not received this yet" or
  "Sent to us at…", the account page's notice, the store's board notice.
- **`tools/db.pl`, the eleventh check**: the order prefix, the statuses
  and the road agree between `schema.sql` and `domain.js`; every table
  has RLS and is revoked before any grant; nothing is granted to `anon`;
  every function is revoked from public, anon and authenticated; every
  SECURITY DEFINER pins its search_path; no hash, secret table or secret
  key in `app/`; `config.js` holds a publishable key or nothing (a
  legacy JWT is decoded and must say `anon`). Each proved by breaking it.
- **Probed from outside on 7 November 2026**, with the publishable key
  and a throwaway anonymous visitor, creating no order: no session reads
  nothing and cannot call `place_order` (401); the visitor's `is_staff()`
  is false, its own orders and the staff list are empty, `shop_secret`,
  `claim_attempts`, a direct INSERT into `orders` and `iso_now()` are all
  refused (403); a wrong store code returns false; `place_order` refuses
  BAD_LINES, BAD_LINE, ITEMS_DO_NOT_ADD_UP and BAD_PROMISE by name;
  `advance_order` and `set_paid` say NOT_STAFF. In the browser: browsing
  makes no session and no request to Supabase; checkout says "Place
  order"; the store page signs in, asks, shows the code form, refuses a
  wrong code and shows nothing behind it; the Realtime websocket opens
  through the office network.
- **The Preview bar** now says an order placed here "is a test, not a
  purchase", because with a database connected it does reach the shop.
- **How it was checked without a project:** a fake Supabase API in the
  browser (a `fetch` stand-in, in temporary pages never committed) took
  an order through `place_order`, let the store in with the code, and
  moved the order along; the payload carried every field `schema.sql`
  reads. And with the config pointed at a dead address: browsing still
  works, "Place order" says it could not reach the shop and keeps the
  bag, and the store page fails shut rather than showing local orders.

## Each item's own status (7 November 2026)

- **The road twice, now four times:** `ORDER_NEXT`/`advance_order` for the
  order, `LINE_NEXT`/`advance_line` for an item (the order's road less
  draft and `abandoned`). `db.pl` compares both pairs of lists and both
  status lists. `sent → cancelled` joined the order's road the same day,
  so a declined online order is cancelled, not "abandoned".
- **The order follows its items** (`roll_up_order`, granted to nobody):
  its status is the slowest item not cancelled; every item cancelled, it
  is cancelled; a rise of several steps writes each into the history.
  `advance_order` moves the items AT the order's old status (an item
  already ahead stays ahead), refuses to cancel an order with an item
  already shipped (`SOME_ITEMS_SHIPPED`), and cancels/returns the rest.
- **Money on a cancel:** items total = what is left; discount =
  `discount_placed × left ÷ all`, so two cancellations never round
  twice; total re-added; shipping and handling unchanged; nothing
  recalculated once every item is gone. `paid_amount` is kept by
  `set_paid`, so `refundDue()` = paid − what is now owed − refunded, the
  same sum as `mark_refund`. Like `paid`, a refund is a person's note;
  `honesty.pl` keeps `markRefund()` to the store board.
- **Going back** (8 November 2026, the owner: "they can undo the status too
  later"). `step_back_order` and `step_back_line`, staff only, move an
  order or one item to any EARLIER step of `LINE_ROAD` — never forward,
  never out of a cancellation or a return, which stay final because money
  and stock follow them (the pop-up says "This cannot be undone" before
  either). The order going back takes the items AT its step with it — the
  mirror of `advance_order` — and an item further along on its own stays;
  an item going back below the order takes the order down with it
  (`roll_up_order` now moves both ways). Written as `{at, to, back: true}`;
  `statusAt()` prefers an entry that is not a step back, so Packed keeps
  the time it was first packed. Back before Shipped clears the courier;
  back from Delivered clears `delivered_at`, so no return window runs for
  a parcel that has not landed — in one browser that is `stepBack()`, the
  second writer of `deliveredAt` that `honesty.pl` allows, to null only.
  ⚠️ **`trackSteps()` and the board count "done" by where the order IS**,
  not by whether a step has a date: a stepped-back order still has Shipped
  in its history. `db.pl` compares both functions' road with `LINE_ROAD`
  and that each checks `is_staff()` first; both proved by breaking them.
  The self-test has five orders and four more rules (10–13). Tested in the
  preview against a stand-in mirroring the SQL: Mark packed from New in
  one pop-up (Confirm, then Pack), Mark shipped with a courier, Back to
  Packed (courier cleared, Packed at its first time, Shipped not green on
  the customer's chain), an item cancelled from its menu with the refund
  offered, the shipped item moved back taking the order down, and the
  message a database not yet re-run gives.
- **Tolerant both ways:** an order read from a database not yet re-run,
  or kept in one browser, has no item statuses, and every per-item control
  and label stays away (`D.hasItemStatus`). The one-browser backend has
  no `advanceLine` at all.
- **`db/selftest.sql`** — run in the SQL editor after `schema.sql` — acts
  as the first staff session, makes four test orders on their own numbers
  (VA-9001…, item ids 9000000011…, so no real sequence moves), checks
  nine rules, and ends with an error on purpose so everything rolls back:
  `ALL GOOD -- every check passed, and nothing was saved`.
- **Proved on the real database, 7 November 2026**: the owner re-ran
  `schema.sql`, then `selftest.sql` answered `ALL GOOD -- every check
  passed, and nothing was saved`. The self-test runs with the SQL editor's
  rights, which skip grants, so the grants were probed from outside as a
  throwaway guest: `advance_line`, `mark_refund` and `advance_order` are
  reachable and say NOT_STAFF; `roll_up_order` is refused outright (403);
  the new item and order columns read back (200, empty under RLS).
- **Tested in the preview** against a stand-in that mirrors the SQL in JS:
  a two-step item move asks first; one item packed leaves the order New;
  paid then the other item cancelled lifts the order to Packed through
  Confirmed, drops the total to the item left, shows "was", and offers
  "Refund ₹1,899" which, marked, becomes "₹1,899 refunded"; the
  customer's page labels items only when they differ, strikes a
  cancelled one, explains the new total, says what is owed and then when
  it went; and with no item statuses shows the plain list.

## Accounts (step 7)

Built 7 November 2026, on the owner's ask ("like we have in the Milan
app"), from Milan's account layer (`kirana/app/backend-supabase.js`,
`kirana/db/SETUP.md` steps 3–5) with two of its gaps closed.

- **Required at checkout since 8 November 2026 — by the page, never by the
  server, and never a password.** The owner: "a person cannot order unless
  they are signed in — how will they ever view that order again". Browsing
  and the bag never ask. `SIGN_IN_TO_ORDER` in `config.js` is the switch;
  `place_order()` still takes a guest (`db.pl` section 8, `honesty.pl`
  5d), deliberately, so a lapsed email sender is one flag from guest
  checkout again rather than a shop that cannot sell. Until 8 November it
  was "offered, never required": a guest ordered exactly as before.
  The sign-in box (`app/signin.js`) lives
  inside three pages — account, checkout, and an order's page after a
  guest's order — and is never a screen of its own. `honesty.pl` rule 5
  was "no login, anywhere" until this step; it was relaxed DELIBERATELY to
  four checks: no login/sign-in route, screen or section; no password
  field in the shop (the store's code form is the one exception); only
  `backend-supabase.js` calls Supabase's sign-in, never with a password;
  `orders.place()` starts by making its own guest session. Each proved
  by breaking it.
- **`SIGN_IN` in `config.js` is the switch** — on since 7 November 2026.
  Off, `store.account` and `store.addresses` stay null — as in
  one-browser mode — and nothing offers to sign in. ⚠️ Turn it off if the
  project ever stops sending codes: out of the box Supabase mails a LINK,
  and only a few an hour, so the box would promise a code that never
  comes.
- **The project's side, done by the owner 7 November 2026:** Brevo, with
  the shop's own sender (a Gmail, so DKIM and DMARC show "not
  recommended" and some codes may land in spam until the shop has a
  domain); Brevo's "block unauthorized IPs" left OFF, because Supabase
  sends from addresses that are not fixed; Supabase custom SMTP;
  manual linking on, secure email change off, OTP length 6; both
  templates carrying `{{ .Token }}`. `schema.sql` re-run, and the new
  rules probed from outside: nothing granted to anon; a guest reads an
  empty address book, cannot read `handovers` or call `signed_in()`,
  gets NOT_SIGNED_IN from all three address functions and from
  `take_handover`, and can make a ticket (48 hex characters).
- **Two roads** (`account.sendCode`). A NEW email is attached to the guest
  session the phone already has (or gets then): Supabase's email change,
  the Change Email Address template, `verifyOtp` type `email_change`.
  Same user, so the guest's orders are the account's already. A KNOWN
  email (an account from another phone): `signInWithOtp` with
  `shouldCreateUser: false`, the Magic Link template, type `email`. This
  phone becomes a different user, so…
- **…a hand-over ticket** carries the guest's orders across: made by
  `make_handover()` while still the guest (a random token only this
  browser held, hashed in `handovers`, one use within the hour), spent by
  `take_handover()` once signed in. Milan lets that guest's data go;
  handing over by user id would let anyone who learned a guest's id take
  its orders.
- **The address book** (`addresses`) is for accounts only — a guest's
  details stay in their browser, as before. Read under `addr_read`
  (owner only — `db.pl` fails if the store, or anyone else, could read
  it); written only by `save_address`, `set_default_address`,
  `delete_address`, each refusing anyone not `signed_in()`. Ten per
  account; the first is the default. Checkout offers them as cards; a new
  address is saved to the account only after the order goes through —
  always since 8 November 2026 (the tick box is gone), unless the same
  address is there already or the book is full.
- **The account's own name and mobile** (8 November 2026) live in
  Supabase's `user_metadata` — `account.saveDetails()`, through
  `updateUser({ data })`, which only the account's owner can call — so they
  follow the person to any phone and prefill a new address. Never read by
  the server to decide anything. The profile page edits them; checkout
  keeps them the first time an order is placed.
- **`signed_in()` reads `auth.users`**, not the token, and is granted to
  nobody: only the functions call it. `db.pl` also fails if
  `place_order()` ever calls it — buying must never need an account.
- **Sign-out is `scope: 'local'`** — supabase-js signs out of every phone
  by default — and takes this browser's details (`profile`) with it, so a
  shared phone does not hand the next customer someone else's address.
  `profile.clear()` used to write a `null` that `get()` then returned;
  it removes the key now.
- **Tested against a stand-in, not the real project.** A fake Supabase in
  the browser (a `fetch` replacement, in the preview only, never
  committed) answered the real supabase-js calls: a new email signed in
  as the same user; a wrong code refused; the address book added, edited,
  defaulted and removed; checkout with a saved address and with a new
  one saved after the order; sign-out local; a guest's order carried into
  an existing account by the ticket, from the order page; checkout's
  in-place sign-in keeping what was typed; 375 and 360 px. With `SIGN_IN`
  off the shop was checked to be what it was before. ⚠️ **What only the
  real project can show**: the codes arriving, the two templates, the
  new SQL running. db/SETUP.md step 7, then the owner signs in with their
  own email.
- **Tested 8 November 2026 against a stand-in** — one fake Supabase for
  both pages, its state in localStorage so an order placed in the shop is
  on the store's board (temporary `app/zz-*` pages, kept out of git by
  `.git/info/exclude` and deleted after): the profile's sign-in with the
  address form already open, an address and the name and mobile saved;
  checkout signed out asking for sign-in first, its button saying so and
  taking the customer to the box; signing in there with an email already
  known (the second-phone road: Magic Link and the hand-over ticket)
  bringing both saved addresses; a new address typed at checkout saved
  with the order; the order cards and the order page's chain following
  the store's moves; 375 px and 1280 px. ⚠️ Still only the real project
  can show the Magic Link template's email arriving.

## Two pages: the shop and the store

| | Page | Entry | Route table | Link |
|---|---|---|---|---|
| **Shop**, for customers | `app/index.html` | `app/app.js` | `ROUTES` | `…/clothes-app/` |
| **Store**, for whoever runs it | `app/owner.html` | `app/owner.js` | `OWNER_ROUTES` | `…/clothes-app/store/` |

- **Two documents, not one with a hidden screen.** The shop imports no
  store module and links nowhere near the store, so a customer's phone
  never downloads the store and no customer can wander into it. The store
  links out to the shop ("View the shop"); the reverse never.
- **What they share is the data layer** (`store.js`), the router (handed a
  table by `start()`), the pure modules and the styles — so an order placed
  in the shop is the order the store lists. Today that means the same
  browser; from step 6, the same database.
- **`owner.html` lives in `app/`, not `store/`**, because `data/`, `img/`
  and `styles/` are read relative to the PAGE. One folder over, it would
  fetch none of them; so `store/index.html` is only a door.
- **The store's tabs are spelled out** in `OWNER_ROUTES`, not matched as
  any word: a catch-all would accept a stray `#/shop` and show the
  overview without a murmur. `routes.pl` checks the list against `TABS` in
  `pages/admin.js`.
- **`routes.pl` checks each page against its own table**, over the modules
  its own entry imports, and fails if the shop loads a store module or names
  `owner.html` or `store/`. Proved by breaking it: an admin import in
  `app.js`, an `owner.html` link in the footer, an old `#/admin` link, and
  `#/shop` inside the store each fail by name.
- ⚠️ **Not locked, and it says so** in a bar on every tab (`honesty.pl`
  keeps it there). There is deliberately no code check in the browser: this
  repository is public, so a code the page can check is a code anyone can
  read. The lock is step 8, on the server. Until then the page can only
  show the orders in the browser it is opened in — which is why it is safe
  to leave open. Both store pages carry `noindex`.
- An order's code on the board opens it **in the shop** (`./#/order/CODE`),
  as the customer sees it. The store has no order screen of its own yet.
- **How an order moves** (step 4). The customer saves it, then sends it
  (WhatsApp, phone, email or copied text); that is the only step that is
  theirs. Everything after is a button on the store's board: *Confirm*,
  *Mark packed*, *Mark shipped* (with an optional courier and tracking
  number), *Mark delivered*. Cancel, returned and abandoned are ends. Since
  8 November 2026 every step asks first in a pop-up (`askFirst`) instead of
  a second tap, and a step can be taken back along the road. `domain.js`
  owns the road (`ORDER_PATH`, `ORDER_NEXT`, `canStepBack`), the words
  (`STATUS_LABEL` for the store, `TRACK_LABEL` for the customer,
  `ACTION_LABEL` for the buttons) and `trackSteps()`, which takes every date
  from the order's own history and never works one out.
- **The customer's order page follows the order live**, and redraws only
  the parts a status can change. A full redraw would also rebuild the
  handoff block, and the Copy button's fallback text box would vanish the
  instant the same tap marked the order sent. Verified: the box stayed.
- Locally: `http://localhost:8150/owner.html`, or
  `http://localhost:8152/store/` to go through the door as Pages does.

---

## Where the code came from

A copy, taken once, at the start — not a dependency, and not a link: see
*A separate project from DEVI*. `devi-collections` is a home-linen
storefront that had already solved,
in production, every structural problem a clothes shop has and a grocery
does not: variant-aware cart lines, a size axis that may carry a price
delta, a product page, a listing page, a wishlist, a seller admin, and
an artwork generator for products with no photograph.

`kirana` is a grocery with three delivery windows a day, a tempo route
and buy-2-get-1 on chip packets. **Almost none of that transfers.** What
it has that DEVI does not is a **working Supabase layer** — schema, row
level security, SECURITY DEFINER functions, email sign-in, and a
288-line setup walkthrough that has been followed end to end.

`FROM-DEVI-AND-MILAN.md` has the file-by-file detail and the traps. It
stays on this machine, git-ignored since 4 November 2026, like `PROMPT.md`:
the published repository is this shop's own.

---

## What this app has that neither parent does

Four things. They are the actual work, and two of them are now partly
built.

### 1. A delivery estimate, as a range

**"Arrives 10–16 November"**, not "Arrives Tuesday". Five to ten
*working* days — Monday to Saturday, Sundays skipped — shown as two
dates with the month named once.

`shop.json` → `shipping.deliveryDays {min, max, basis}`, so changing the
promise is an edit and not a code change. `domain.js` owns
`deliveryEstimate()` and `fmtDateRange()`. `data.pl` fails if `min` is
above `max`, because a range that prints backwards reads as a broken
shop rather than as a bad number in a file.

**Live on the product page and the shipping page**, which is correct
*there*: both answer "if I order today, when does it arrive", and that
answer must move as today moves. **Frozen on the order**, since step 5,
and read back everywhere else. The trap is not that the arithmetic
drifts; it is that the day the owner edits `deliveryDays` from 5–10 to
4–8, every open order would silently get a new promise. The customer
screenshots the first one.

- **Frozen the moment the order reaches the shop** — `advance()` in the
  backend, at draft → sent, through `arrivalPromise()`: `{from, to,
  minDays, maxDays, countedFrom}`. Never overwritten. A saved order that
  has not been sent has reached nobody, so it has no promise; its page
  says "Arrives 5–10 working days after you send it to us", in days, not
  dates. From step 6 an order reaches the shop the moment it is placed,
  and the two moments become one.
- **Shown** under the order's title ("Should arrive 10–16 November, once
  we confirm it", then "Arrives …"), as the due date on the timeline's
  last step, in *Your orders*, in the text sent to the shop, and on the
  store's board as "Promised …", with a **Late** flag and a line under
  *Needs attention* once the last day has passed undelivered.
- **`honesty.pl` fails** if any order screen calls `deliveryEstimate()`,
  if anything but the backend calls `arrivalPromise()`, if `arrives` gets
  a second writer or loses its never-overwrite guard, or if a new order
  does not start with `arrives: null`. Each proved by breaking it.
- **Verified by the real trap**, 4 November 2026: an order sent with
  5–10 days showed 10–16 November; `deliveryDays` was then edited to 4–8
  on disk. The product page and the strip moved to 4–8 (9–13 November);
  the order stayed at 10–16. `shop.json` was restored byte for byte.

### 2. A seven-day return window, counted from DELIVERY

`shop.json` → `returns {days, from, free}`, and **`data.pl` FAILS if
`from` is anything but `delivery`.** Counted from placement, a seven-day
window on a parcel that takes ten working days to arrive would expire
before it landed — the customer receives a garment they were already
unable to send back.

So `deliveredAt` is stored the moment the status becomes `delivered`
-- by `advance()` in the backend, the one writer `honesty.pl` allows --
and the window is counted from that stamp. `returnWindow()`
returns `null` while the parcel has not landed, deliberately: there is
no window to show, and inventing one from `placedAt` is the bug the
signature exists to prevent.

⚠️ **Free returns is a cost, not a feature**, and it is still unpriced.
See *Still not answered*.

### 3. Orders that leave the browser

**Built in steps 6 and 7.** DEVI has **no login, anywhere, ever** —
right for a shop that sends a WhatsApp handoff. This app cannot work that
way: a customer waiting ten days for a parcel must be able to open the
app on a different phone and see where it is.

Milan's account layer — anonymous Supabase session upgraded with email +
a six-digit code. **No password, ever.** `honesty.pl`'s no-login rule was
relaxed deliberately when step 7 landed, not quietly: see *Accounts*.

### 4. Sizes that are garment sizes

S/M/L/XL/XXL. **Only the size axis may carry a price delta**, and for a
garment that is real rather than inherited: XL is +₹50 and XXL is +₹100
because they take more cloth. The MRP moves with the price, so the
discount percentage stays honest at every size.

**Size charts live in `shop.json` → `sizeCharts`, one per garment type**,
not one per product: an M is the same M across every shirt on this
floor, and five rows copied onto every product is how the numbers drift
apart. A product names its chart with `sizeChart`.

`data.pl` **fails** if a chart is missing, if it does not carry a row for
every size that product sells, if a row has the wrong number of values,
or if a chart is orphaned. A size with no row renders a blank line in
the table, which a customer reads as "no measurement needed for XXL"
rather than as a missing number — and the return that follows costs more
than the check does.

⚠️ **Every column declares whether it is the body or the garment**, and
the table prints that word under the heading. This is not decoration:
"To fit chest 40" means the shirt fits a 40 in chest, while the shirt
itself measures more, because it needs ease to be wearable. Somebody who
measures a shirt they already own against a body column reads every size
as too small and orders one up — a return caused by the chart that was
supposed to prevent it.

The wording lives in `shop.json` → `measureNotes`, keyed by the column
heading exactly as `sizeCharts` spells it, so renaming a column **fails
`data.pl`** rather than quietly dropping that column's guidance out of
the table. `data.pl` also fails on an `on` that is not `body` or
`garment`, and on an orphaned note.

**The numbers are invented** — a realistic Indian grading, not this
manufacturer's spec sheet.

⚠️ **A garment is never added in a size nobody chose** — the owner's
call, 7 November 2026. Both pages used to: a card's Add to bag put the
first size, S, in the bag without asking (inherited from DEVI, where a
default size did little harm), and the product page came with S already
selected. Now a card opens a size panel and adds only the size tapped,
and the product page starts with no size, asks for one under the sizes
("Pick a size first. Nothing has gone in your bag yet."), and adds
nothing until it has one. A product with a single size has nothing to
choose and gets it. The chips on a card say what a size costs extra (XL
+₹50), because the card shows the S price.

The chart is on the product page as a **Size guide** panel, with the
selected size highlighted. ⚠️ More important than the panel is the ONE
LINE under the size picker — "Fits a 40 in chest" — which costs no taps
at all. Most people never open a size guide; the number that changes a
decision is the one already on screen beside the size they just tapped.

---

## Stack and constraints — carried over, not negotiable

- **No Node, no npm. Python is blocked by group policy.** Perl 5.42.2 at
  `%USERPROFILE%/AppData/Local/Programs/Git/usr/bin/perl.exe`.
- Therefore **zero build step** — vanilla HTML/CSS/ES modules.
- ES modules refuse to run over `file://`, so local work needs the
  server above.
- **There IS a browser here.** Use it. Everything in the second commit
  was found by tapping and none of it was visible to a check script.
- ⚠️ **The preview pane draws no animation frames** (found 7 November
  2026: `document.timeline` did not move in 600 ms, one rAF frame). A Web
  Animation never finishes there by itself, so test one by pausing it from
  `document.getAnimations()` and stepping `currentTime` or calling
  `finish()`. `flyToBag`'s fallback timer is why the bag's count still
  lands there; on a real screen the animation runs on its own.

### The rules both parents learned the hard way

- **Money is integer rupees everywhere.** No floats, no `toFixed`.
- **A cart line stores no price**, and line identity is
  `pid|colour|size`, never `pid`. Two sizes of one shirt are two lines.
- **Every date and clock read lives in `domain.js`**;
  `toISOString().slice(0,10)` is BANNED and grepped.
- **`hourCycle: 'h23'`, never `hour12: false`.**
- **`ui.js` / `router.js` must never import a page module.** `ui.js` may
  import `domain.js` — it is pure and imports nothing, so there is no
  cycle. The rule is about pages.
- **`[hidden]{display:none !important}` is load-bearing.**
- **No literal colours outside the token block.** Never hardcode `#fff`.
- **An input must never sit inside the region its own handler repaints.**
- **A promise stated on more than one screen is built in ONE function.**
  `shippingLine()` and `returnsLine()` in `domain.js`, for the same
  reason `orderSummaryText()` exists. Three screens each assembling the
  same sentence is three sentences that drift.

---

## What changed from DEVI, and why

Read this before assuming a DEVI behaviour still holds.

- **`art.js` silhouettes are garments.** `shirt`, `kurti`, `dress`,
  `top` replaced `folded`/`drape`/`runner`/`vessel`/`stool`/`bag`/
  `pouch`/`envelope`. DEVI's `garment` shape survived its narrowing to
  linen and is the ancestor of `kurti`. **Motif pools are per garment**:
  a men's shirt draws only woven and geometric prints, never a floral
  buti — the same decision as DEVI's "a razai never gets an ikat
  chevron".
- **Band rects come from the shape**, not one constant. A dress flares
  from 88px at the waist to 160px at the hem, so DEVI's single hardcoded
  hem rect either floated inside the skirt or hung out of it.
- **`MEDALLIONS` became `CHEST`.** DEVI's were 140px across, centred on
  a 272px-wide bedsheet. A kurti body is 116px wide, so the same device
  clipped to a band across its middle and read as a mistake. These are
  the same four ideas at garment scale.
- **`shipsIn` is gone**, replaced by `deliveryDays`. Three screens used
  it.
- **The free-shipping threshold is dormant** — delivery is free, so
  `fee: 0, freeOver: 0`. ⚠️ `money.pl` therefore pins the rule against
  **synthetic** rules, and so do the 500 random baskets. Against the
  live numbers every basket clears a threshold of zero and the whole
  assertion is unreachable — which is precisely how kirana hid a real
  pre-coupon/post-coupon disagreement for months.
- **`data.pl`'s category counts are named constants** at the top of the
  file, `$EXPECT_CATS` and `$EXPECT_SUBS`. Bump them deliberately. A
  magic number buried in a condition gets edited without being read.

### Bug found in DEVI while copying

`components.css` carried a bare `(max-width:1023px){` with **no
`@media`**, so three brand-band sizing rules have been silently dead
there as well. Fixed here. Worth telling that project.

---

## The order of work

Steps 1–5 are the demo. 6–10 make it a shop.

1. ✅ **Copy DEVI, strip to a skeleton, serve it.**
2. ✅ **The size chart on the product page.**
3. ✅ Cart, coupon, totals — `money.pl` green.
4. ✅ **Checkout and a real order**, still in local storage. The order page tracks it step by step, the store moves it from Confirm to Mark delivered, and `deliveredAt` is a field of its own. 4 November 2026.
5. ✅ **Freeze the delivery range into the order at placement** — as it reaches the shop, read back everywhere after, with a Late flag on the store's board. 4 November 2026.
6. ✅ **Supabase** — built 4 November 2026, connected 7 November 2026 to the shop's own project. Left: the owner's first real test order, from a phone, seen on the store page.
7. ◐ **Accounts**, so a parcel can be tracked from a second phone. Built, set up and switched on, 7 November 2026; the owner's first code arrived by email the same day. Left: signing in on a second phone (the Magic Link template), and seeing the orders and addresses there.
8. ⬜ **The store view, locked**, behind `claim_staff()`. The page and its own link exist since 4 November 2026; what is left is the code check on the server and reading every phone's orders from the database.
9. ⬜ **Returns** — the seven-day clock from `deliveredAt`.
10. ⬜ **Real photographs**, whenever the owner can supply them. Stand-ins have been in place since 4 November 2026, and `data.pl` will not let `placeholder` go false while one is still shown.

---

## Open, and owned by the user

- ⚠️ **The server does not check prices or coupons** (see *The
  database*). Before real customers: give it the catalogue's prices — a
  table generated from `catalog.json`, or one the store page refreshes —
  and have `place_order` price each line itself. Stock belongs there too,
  so two phones cannot both buy the last one.
- ⚠️ **`placeholder` is `true`, and `data.pl` FAILS while it is.** The
  brand name, the brand story, the year, every contact field and all
  three prices are **invented** — realistic, not real. The owner has not
  chosen a name. That flag makes shipping them impossible rather than
  merely inadvisable.

  **To clear it:** fill in `contact` in `app/data/shop.json` — including
  `returnsAddr` and `gstin` — check the prices, set `placeholder` to
  false.

  ⚠️ **The phone, WhatsApp and email are DUMMIES** since 7 November 2026,
  so the demo shows its Call, WhatsApp and Email buttons: `+91 12345
  67890` (not an Indian mobile — those start 6 to 9 — so WhatsApp and the
  dialler refuse it) and `orders@example.com` (a reserved domain that
  takes no mail). A real-looking number would message a stranger.
  `data.pl` fails if either survives `placeholder` going false, and fails
  on a WhatsApp number that is neither a mobile nor the dummy.

- **`honesty.pl` was narrowed twice on 7 November 2026, deliberately**:
  rule 1's banned phrases ("payment received" and the rest) no longer scan
  the store's own files, which customers never open and where "Mark
  payment received" is the owner's button for what they saw in the bank;
  every shop page is still held to all four. And the "Not set up yet"
  gateway notice left the load-bearing list, because the card options it
  explained are gone. **Twice more on 8 November 2026, as deliberately:**
  rule 4b lets `stepBack()` set `deliveredAt` back to null (and nothing
  else write it); rule 5 is no longer "signing in is never required" but
  "never required BY THE SERVER" — checkout asks for it, `place_order()`
  still takes a guest.

- ⚠️ **The photographs are stand-ins, and that is still the biggest risk
  to the whole idea.** Since 4 November 2026 every product, both category
  tiles and both hero panels show photographs from Unsplash, chosen
  because the drawn garments looked "too kiddish" to the owner. They are
  of other people's garments: on a real shop a stand-in is a picture of
  a garment the customer will not receive. So every one is marked
  `stock: true` in `shop.json` `photos`, the Preview bar says "photos",
  and `data.pl` FAILS if `placeholder` goes false while any stock
  photograph is still shown.

  How they are laid out, so the real shoot can drop straight in:
  - **Four photographs per product**, `img[0..3]`. Each colour's `img`
    index points at its own photograph; the remaining slot is a close-up.
    `viewCount()` follows the length of `img`, so more photographs simply
    mean more thumbnails.
  - **4:5 for products, 3:4 for category tiles, 4:5 for the hero**, at
    1000 px wide. Unsplash crops and sizes on its own servers, so each
    entry's `fetched` URL is the exact crop -- fetch it again with another
    `w`/`h` and nothing else changes.
  - **Every colour name and swatch was taken from its photograph.** The
    swatch hex is the median of a patch of plain cloth in the image, so
    the dot under a card matches the photo above it. The shirt is
    short-sleeved in its photographs, so its size chart's Sleeve column
    is short-sleeve lengths now.
  - **No faces where it could be helped.** The shirts hang on a branch,
    the kurtis are on a dress form, the dresses are cropped below the
    chin, the tiles and hero are rails and machines. A model's face on a
    shop that is not theirs reads as an endorsement nobody gave.
  - **Credits are owed even where the licence does not demand them.**
    The About page lists them from the same `photos` list the check
    reads, so a photograph cannot be added without its credit.

- **The palette is still DEVI's** — warm ivory, antique gold,
  terracotta, light-only, 67 tokens. It survives the move to apparel
  better than expected, but it was chosen for a home-linen brand and
  nobody has asked whether it is right for this one.

- ⚠️ **`deliveryEstimate()` has no Perl check.** The Sunday skip and the
  month-boundary formatting were verified once in a browser, on one
  date. A `promise.pl` belongs with step 5, covering both the arithmetic
  and the freeze.

- ⚠️ **Hash routes do not rank in search.** Fragments are poorly
  crawled. Real SEO needs server-side rendering or a prerender build,
  and there is neither. For a shop whose whole problem is distribution,
  this is worth knowing early rather than in month three.

- **The checkout still hands off on WhatsApp**, inherited from DEVI, and
  is honest about it on screen. It stops being honest the moment the
  copy promises tracking the browser cannot deliver, so steps 4–7 move
  together.
