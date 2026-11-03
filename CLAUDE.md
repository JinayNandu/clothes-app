# Clothes app — project context

⚠️ **Nothing is built yet.** This file is a starting brief, not a record
of decisions already taken. Rewrite it as things get settled; the
Milan and DEVI versions of this file are what it should grow into.

---

## What this is

A storefront for a **garment manufacturer who already makes clothes for
brands and has no way to sell them under their own name.** They have the
stock and the designs; what they lack is distribution. This is the
distribution.

The shape is Amazon or Nykaa, not a kirana: a catalogue you browse by
eye, sizes and colours, a cart, an order that arrives in **five to ten
days**, and **free returns for seven days** after it lands.

Personal side-venture of the user, not client work.

---

## ⚠️ START FROM `devi-collections`, NOT FROM `kirana`

The user's instinct was to copy the Milan grocery app. **That is the
wrong parent**, and it is worth saying why before anybody starts
copying files.

`%USERPROFILE%\Projects\devi-collections` is already a textile
storefront — a premium home-linen brand selling bedsheets, quilts and
table runners. It has solved, in production, every structural problem a
clothes shop has and a grocery does not:

| | |
|---|---|
| **Variants** | A cart line is `{pid, qty, variant}`. Line identity is `pid\|colour\|size`, never `pid`. This is THE structural difference between selling atta and selling a kurta, and it is already done. |
| **Sizes that cost more** | Only the SIZE axis may carry a price `delta`. A king sheet costs more than a single; an XXL may cost more than an S. |
| **Returns** | `shipped → delivered → returned` is already in `ORDER_NEXT`. |
| **A product page** | `app/pages/product.js` — gallery, variant picker, the lot. A grocery has no product page on purpose; a clothes shop is nothing without one. |
| **Listing, wishlist, account, admin** | All in `app/pages/`. |
| **Artwork without photographs** | `app/art.js` generates a product image when there is no `img` key. For a shop whose photographs do not exist yet, this is the difference between a demo and an empty grid. |

Milan (`%USERPROFILE%\Projects\kirana`) is a grocery with three
delivery windows a day, a tempo route, buy-2-get-1 on chip packets and a
pure-veg rule. **Almost none of that transfers.** What Milan has that
DEVI does not is the **working Supabase layer** — schema, row-level
security, SECURITY DEFINER functions, email sign-in, and a 288-line
setup walkthrough that has actually been followed end to end.

**So: the storefront comes from DEVI, the database comes from Milan.**
See `FROM-DEVI-AND-MILAN.md` for file-by-file detail.

---

## What this app has that neither parent does

Four things. They are the actual work.

### 1. A delivery estimate, as a range, frozen at placement

Not "Tuesday". **"Arrives 10–15 November."** Five to ten working days,
shown as two dates.

⚠️ **Snapshot the range into the order when it is placed.** Do not
recompute it on the track screen from `placedAt` every time it renders —
the same trap as storing a price on a cart line. A promise that moves is
worse than no promise, and the customer will screenshot the first one.

The number of days belongs in `shop.json` beside the shipping rules, so
changing it is an edit and not a code change. Milan's lesson: everything
the owner owns lives in one JSON file.

### 2. A seven-day return window, counted from DELIVERY

Not from placement. So `deliveredAt` has to be stored the moment the
status becomes `delivered`, and the window is computed from it.

The customer-facing states are roughly `return_requested → picked_up →
refunded`. Settle with the owner whether a refund is money back or
credit — it changes the screen and it changes what you promise.

⚠️ **Free returns is a cost, not a feature.** Ask what a return actually
costs them before building a button that invites one. For a
manufacturer with no reverse logistics, "free returns" may mean "we eat
the courier both ways on a ₹700 kurta". Better to find that out now.

### 3. Orders that leave the browser

DEVI has **no login, anywhere, ever** — a deliberate rule there, and
right for a shop that sends a WhatsApp handoff. This app cannot work
that way: a customer waiting ten days for a parcel must be able to open
the app on a different phone and see where it is.

So take Milan's account layer: anonymous Supabase session upgraded with
an email + six-digit code. **Do not invent a password.**

### 4. Sizes that are garment sizes

S/M/L/XL/XXL, and a **size chart** on the product page with actual chest
and length measurements in inches. Most clothing returns are fit, so the
size chart is not decoration — it is the cheapest return-prevention
there is.

---

## Stack and constraints — carried over, not negotiable

- **No Node, no npm. Python is blocked by group policy.** Perl at
  `%USERPROFILE%/AppData/Local/Programs/Git/usr/bin/perl.exe`.
- Therefore **zero build step** — vanilla HTML/CSS/ES modules.
- ES modules refuse to run over `file://`, so local work needs
  `perl tools/serve.pl 8110 app`.
- **There IS a browser here.** Use it. Both parent projects were
  verified by clicking, not by reading.

### The rules both parents learned the hard way

Copy these before copying any code:

- **Money is integer rupees everywhere.** No floats, no `toFixed`.
- **A cart line stores no price.** Price resolves from the catalogue at
  render and freezes into the order line at placement.
- **Every date and clock read lives in `domain.js`**, and
  `toISOString().slice(0,10)` is BANNED and grepped — it is UTC, so on
  an IST device between 00:00 and 05:30 it returns yesterday.
- **`hourCycle: 'h23'`, never `hour12: false`** — the latter returns
  `"24:00"` for midnight in several engines.
- **`ui.js` / `router.js` must never import a page module.** A circular
  ES import hands you `undefined` for something that looks hoisted.
- **`[hidden]{display:none !important}` is load-bearing.**
- **No literal colours outside the token block**, and a `-ink` variant
  for text on every filled accent. Never hardcode `#fff`.
- **Patch `i18n.js` in RAW BYTES.** No decode, no encode. Devanagari
  through UTF-8 twice is 28 lines of silent rubbish, and it has happened.
- **An input must never sit inside the region its own handler repaints**
  — that is how a search box loses the phone keyboard.

---

## Things to settle with the owner before building

Flagged rather than guessed. The app is a prop; the answers are the
product.

1. **One manufacturer, or many?** Everything below changes. Default to
   one — Milan has `db/MULTISTORE.md` for the day it is many, and that
   day is cheaper to reach than to start from.
2. **What do they actually make?** Kurtis, shirts, childrenswear,
   saris? The catalogue, the size axis and the photography all follow.
3. **Do they have photographs?** If not, `art.js` carries the demo, but
   nothing sells a garment like a photograph of it. This is the single
   biggest risk to the whole thing.
4. **What does a return cost them?** See above.
5. **Prepaid or cash on delivery?** COD on a ten-day shipped parcel is a
   different risk from COD on a grocery bag delivered round the corner.
6. **Who ships it?** Delhivery, Shiprocket, India Post, a local courier?
   The five-to-ten-day promise is theirs to keep, not the app's.
7. **Returns address, GST, and the legal page.** A shop selling to
   strangers needs them; a kirana delivering down the lane did not.
