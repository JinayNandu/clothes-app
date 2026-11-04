# Clothes app — project context

Read this before changing anything. Everything here was either
established by testing or decided deliberately; none of it is a guess.

**Status: step 1 of 10 is built.** A walkable skeleton with three
garments. See *Where this is* and *The order of work*.

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

### Settled with the owner, 4 November 2026

| Question | Answer |
|---|---|
| What do they make? | **Men's shirts, and womenswear across the board** — tops, kurtis, dresses. The skeleton carries one shirt, one kurti, one dress. |
| One manufacturer or several? | **One.** Milan's `db/MULTISTORE.md` is there for the day it is more, and that day is cheaper to reach than to start from. |
| Photographs? | **None.** `art.js` carries the whole catalogue. ⚠️ Still the single biggest risk to the idea — see *Open*. |
| How do they pay? | **UPI and cash on delivery.** Both. The UPI id is a demo one that cannot resolve, and the checkout says so. |

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
| Browse — home, category listing, product page, gallery, variant picker | **Built.** Inherited from DEVI, re-pointed at garments |
| Cart, coupon, totals | **Built.** `money.pl` green, including the size delta |
| Checkout, address, pay options | **Built**, still DEVI's: it saves to this browser and hands off on WhatsApp |
| Catalogue | **3 products**, 2 categories, 3 subcategories. Prices and products INVENTED |
| Size charts | **Built.** A Size guide panel on the product page, plus a no-tap fit hint under the picker |
| Delivery range | `deliveryEstimate()` works and the shipping page uses it. **NOT yet frozen into an order** — step 5 |
| Return window | Config and `returnWindow()` exist. **No return flow** — step 9 |
| Database, accounts, seller view | **Not started** — steps 6, 7, 8 |
| Brand name and identity | **PLACEHOLDER.** "Vastra Apparel" is invented |
| Public site | <https://jinaynandu.github.io/clothes-app/> — see *Published*. Wears a Preview bar while placeholder is true |

### Running it

```bash
perl tools/serve.pl 8150 app
```

**Port 8150**, because 8110/8111 are kirana, 8120 is scorer-dev,
8130–8133 are DEVI and 8140 is orb. `perl tools/serve.pl --lan 8151 app`
for a phone on the same Wi-Fi — opt-in, and it will often fail on a
managed network, which is not a bug in the server.

```bash
perl tools/check.pl        # ten checks
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
  `app/` as the root and so cannot show it: `.nojekyll`, LF endings, the
  redirect keeping `location.hash`, no root-relative URL, exact-case paths.
- **The Preview bar** is on every page while `placeholder` is `true` in
  `shop.json`, and goes with it.

---

## ⚠️ The storefront is DEVI's, the database will be Milan's

`devi-collections` is a home-linen storefront that had already solved,
in production, every structural problem a clothes shop has and a grocery
does not: variant-aware cart lines, a size axis that may carry a price
delta, a product page, a listing page, a wishlist, a seller admin, and
an artwork generator for products with no photograph.

`kirana` is a grocery with three delivery windows a day, a tempo route
and buy-2-get-1 on chip packets. **Almost none of that transfers.** What
it has that DEVI does not is a **working Supabase layer** — schema, row
level security, SECURITY DEFINER functions, email sign-in, and a
288-line setup walkthrough that has been followed end to end.

`FROM-DEVI-AND-MILAN.md` has the file-by-file detail and the traps.

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

⚠️ **NOT YET FROZEN INTO AN ORDER.** Today it is computed live on the
product page and the shipping page, which is correct *there* — both
answer "if I order today, when does it arrive", and that answer must
move as today moves. **Step 5 is to snapshot it onto the order at
placement and read it back**, never recompute it from `placedAt`. The
trap is not that the arithmetic drifts; it is that the day the owner
edits `deliveryDays` from 5–10 to 4–8, every open order silently gets a
new promise. The customer screenshots the first one.

### 2. A seven-day return window, counted from DELIVERY

`shop.json` → `returns {days, from, free}`, and **`data.pl` FAILS if
`from` is anything but `delivery`.** Counted from placement, a seven-day
window on a parcel that takes ten working days to arrive would expire
before it landed — the customer receives a garment they were already
unable to send back.

So `deliveredAt` must be stored the moment the status becomes
`delivered`, and the window counted from that stamp. `returnWindow()`
returns `null` while the parcel has not landed, deliberately: there is
no window to show, and inventing one from `placedAt` is the bug the
signature exists to prevent.

⚠️ **Free returns is a cost, not a feature**, and it is still unpriced.
See *Still not answered*.

### 3. Orders that leave the browser

Not built. DEVI has **no login, anywhere, ever** — right for a shop that
sends a WhatsApp handoff, and `honesty.pl` still enforces it. This app
cannot work that way: a customer waiting ten days for a parcel must be
able to open the app on a different phone and see where it is.

Milan's account layer — anonymous Supabase session upgraded with email +
a six-digit code. **Do not invent a password.** Steps 6 and 7, and
`honesty.pl`'s no-login rule has to be relaxed deliberately when they
land, not quietly.

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
4. ⬜ **Checkout and a real order**, still in local storage.
5. ⬜ **Freeze the delivery range into the order at placement.**
6. ⬜ **Supabase** — follow `kirana/db/SETUP.md`, do not improvise.
7. ⬜ **Accounts**, so a parcel can be tracked from a second phone.
8. ⬜ **The seller view**, behind `claim_staff()`.
9. ⬜ **Returns** — the seven-day clock from `deliveredAt`.
10. ⬜ **Real photographs**, whenever the owner can supply them.

---

## Open, and owned by the user

- ⚠️ **`placeholder` is `true`, and `data.pl` FAILS while it is.** The
  brand name, the brand story, the year, every contact field and all
  three prices are **invented** — realistic, not real. The owner has not
  chosen a name. That flag makes shipping them impossible rather than
  merely inadvisable.

  **To clear it:** fill in `contact` in `app/data/shop.json` — including
  `returnsAddr` and `gstin` — check the prices, set `placeholder` to
  false.

- ⚠️ **No photographs, and this is the biggest risk to the whole idea.**
  `art.js` is good enough that the catalogue does not look broken, and
  it is not good enough to sell a garment. Nothing sells a garment like
  a photograph of it. The swap path is live per product *and* per view,
  so a partial shoot stays coherent, and adding one is a data edit plus
  a file.

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
