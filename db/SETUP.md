# Putting this shop on its own database

Until this is done the shop runs as it always has: everything in one
browser, and **an order placed on a customer's phone never reaches the
store page**. This fixes exactly that.

The site stays on GitHub Pages. Supabase is only the database behind
it: no server to run, no monthly bill.

Followed from Milan's `kirana/db/SETUP.md`, which has been walked end
to end — but this is **its own project**. Not Milan's, not DEVI's.

Every dashboard link below opens **this shop's own project**, ref
`tquymsewhzfawjkyysax` (8 November 2026). They used to carry `_`, which
Supabase turns into whichever project was used LAST -- Milan's, as like
as not. ⚠️ Before running any SQL, look at the project name at the top
left of the editor.

---

## 1. Make the project — 2 min

[supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.

- **Name:** anything — `clothes-app` is fine.
- **Region: Mumbai (ap-south-1).** It cannot be changed later, and every
  tap on a phone in India goes there and back: Mumbai is about 20 ms,
  the US about 250.
- **Database password:** save it in your password manager. The app never
  uses it, and it cannot be shown again.
- Under **Security**:

  | | |
  |---|---|
  | Enable Data API | **on** |
  | Automatically expose new tables | **off** — `schema.sql` grants each table by name instead |
  | Enable automatic RLS | **on** |

⚠️ **The free plan allows two active projects.** Milan's is one. If you
already have two, pause one first, or this one will not be created.

## 2. Create the tables — 1 min

[SQL Editor](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/sql/new) → paste
**all** of [`db/schema.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/schema.sql)
→ **Run**. Expect *"Success. No rows returned."* It is safe to run again.

It makes the orders, their lines, the staff list and the store-code
lock, a signed-in customer's address book (step 7), and the rules for
who may read what. Nobody — customer or store —
writes a table directly; every write is a function that checks itself.

## 3. Set the store code — 1 min

A new SQL tab → paste all of
[`db/store-code.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/store-code.sql)
→ on the line `declare code text := 'CHANGE-ME';` replace `CHANGE-ME`
with your code → **Run**.

- **8 to 24 lowercase letters or digits.** Not the shop's name, not a
  phone number: they are the first things anybody would try.
- ⚠️ **Type it only in the SQL editor.** Never into the file, never into
  a chat, never into a commit: it opens every customer's name, phone and
  address. Run unchanged, the file stops with an error on purpose.
- The store page asks for it once per phone. A phone let in stays in
  until its browser data is cleared.

## 4. One auth switch — 1 min

[Authentication → Sign In / Providers](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/auth/providers)
→ **Allow anonymous sign-ins: on.**

Every customer gets a quiet session at the moment they place an order,
so nobody is asked to sign in to buy a shirt, and every order still has
an owner the rules can check. Email sign-in, and the six-digit code it
sends, is step 7 below.

## 5. Send two values — 1 min

[Settings → API Keys](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/settings/api-keys/)

- **Project URL** — `https://xxxxxxxxxxxxxxxxxxxx.supabase.co`
- **Publishable key** — begins `sb_publishable_…` (an older project may
  show a legacy **anon** key beginning `eyJ…`; either works)

Both are **public by design**: every customer's browser receives them.
Paste them into the chat, and Claude puts them into `app/config.js`,
checks the project from the outside, and publishes.

⚠️ **Never the secret key** (`sb_secret_…`, or a legacy
`service_role`). It ignores every rule in `schema.sql`. `tools/db.pl`
fails if one ever lands in `config.js` — and if one has been pasted
anywhere, rotate it in the dashboard.

## 6. Open the store — 1 min, after it is published

Open `…/clothes-app/store/` and type the store code. That phone is now
the store: it sees every order from every phone, as they are placed.

## 7. Customers signing in — about 15 min

A customer may sign in with their email and a **six-digit code** —
never a password — and their orders and saved addresses then open on any
phone. Nobody has to: a guest orders exactly as before. Until this step
is done and Claude switches `SIGN_IN` on in `app/config.js`, the shop
offers no sign-in anywhere.

Followed from Milan's guide (`kirana/db/SETUP.md`, steps 3 to 5), which
was walked end to end — with this shop's **own** sender.

### 7a. Run `schema.sql` again — 1 min

As in step 2: [SQL Editor](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/sql/new)
→ paste **all** of [`db/schema.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/schema.sql)
→ **Run** → *"Success. No rows returned."*

It adds the address book and the hand-over table. Nothing that exists is
changed: no order, no line, not the store code.

### 7b. An email sender — 10 min

⚠️ **Supabase lets you edit an email template only once custom SMTP is
set up**, and an unedited template mails a sign-in **link**, not a code.
No SMTP, no code.

[brevo.com](https://www.brevo.com) is free for 300 emails a day and needs
no domain:

1. Sign up, or use the Brevo account you already have.
2. **Senders** → add **this shop's own address** — the one customers
   will see the code come from. ⚠️ **Not Milan's**: a Vastra customer
   must not get a code from a grocery's address. A plain Gmail works;
   Brevo emails it a link to confirm.
3. [app.brevo.com/settings/keys/smtp](https://app.brevo.com/settings/keys/smtp)
   → copy the **SMTP login** shown there, and **generate an SMTP key**.
   ⚠️ An **SMTP key**, not an API key: the wrong one fails with *535
   Authentication failed*. It is shown **once** — paste it straight into
   the next step, and **never into the chat**.
4. [Supabase → Authentication → SMTP](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/auth/smtp)
   → **Enable custom SMTP**:

   | | |
   |---|---|
   | Host | `smtp-relay.brevo.com` |
   | Port | `587` |
   | Username | the SMTP login from step 3 — **copy what Brevo shows** |
   | Password | the SMTP key |
   | Sender email | the address added in step 2 |
   | Sender name | the shop's name, as customers should read it |

5. [Authentication → Rate Limits](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/auth/rate-limits)
   → raise the cap on emails sent per hour; it starts low even with your
   own SMTP.

### 7c. Four switches — 2 min

[Authentication → Sign In / Providers](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/auth/providers):

| | |
|---|---|
| **Allow anonymous sign-ins** | **on** — already, from step 4 |
| **Allow manual linking** | **on** — a guest who signs in keeps what they did as a guest |
| **Email** (the provider) | **on**, and inside it: |
| ↳ **Secure email change** | **off** — on, it would send a second code to an "old" address nobody signing in here has |
| ↳ **Email OTP Length** | **6** — `OTP_LEN` in `app/config.js` must match it |

### 7d. Make the email carry a code — 2 min

⚠️ **Two templates, and editing only one is why no code arrives.** Which
one Supabase sends depends on whether the email is new to the shop:

| the customer | the template |
|---|---|
| signs in for the first time — the email is new | **Change Email Address** |
| signs in to the account they made on another phone | **Magic Link** |

The first is the common one, and the surprising one: the guest session
a phone already has *takes* the email, so the orders placed on it stay
theirs, and Supabase calls that an email change.

[Authentication → Emails](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/auth/templates)
→ **both** of those templates → **Source**, the same body in each:

```html
<h2>Your sign-in code</h2>
<p><strong>{{ .Token }}</strong></p>
<p>It expires in an hour. If you did not ask for it, ignore this email.</p>
```

Subject: `Your sign-in code`.

⚠️ **`{{ .ConfirmationURL }}` must not stay in either body.** That one
variable decides link or code, and a body holding both sends the link.

The **Confirm signup** template is never sent by this shop: a new email
always takes the first road above.

### 7e. Tell Claude — 1 min

Say it is done. Claude probes the new rules from outside, switches
`SIGN_IN` on and publishes; then **you** sign in on the live site with
your own email — the code comes to your inbox, which only you can read.

## 8. Each item's own status, and refunds — 2 min

Since 7 November 2026 the store can move or cancel **one item** of an
order, and note a refund when a paid item is cancelled. The page shows
none of it until the database has it.

1. [SQL Editor](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/sql/new) →
   paste **all** of [`db/schema.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/schema.sql)
   → **Run** → *"Success. No rows returned."* It adds a status to every
   item (orders already placed get theirs from the order), and the
   functions that move one item, follow it with the order, and note a
   refund. Nothing that exists is lost.
2. A new SQL tab → paste **all** of
   [`db/selftest.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/selftest.sql)
   → **Run**. It acts as the store, walks its test orders through
   every rule, and then undoes all of it **by ending in an error on
   purpose**. The message you want is:

   > ALL GOOD -- every check passed, and nothing was saved

   Any other message names the check that failed — send it to Claude.
   If it says no phone has been let into the store yet, open the store
   page, type the store code, and run it again.

## 9. Going back a step — 2 min

Since 8 November 2026 the store can move an order, or one item, **back**
to an earlier step after a wrong tap — Shipped back to Packed. Until the
database has it, the store page says so when you try: *"Going back needs
the latest database update."* Everything else works as before.

1. [SQL Editor](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/sql/new) →
   paste **all** of [`db/schema.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/schema.sql)
   → **Run** → *"Success. No rows returned."* It adds the two functions
   that step back (`step_back_order`, `step_back_line`) and teaches the
   order to follow an item back down. Nothing that exists is lost.
2. A new SQL tab → paste **all** of
   [`db/selftest.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/selftest.sql)
   → **Run**. It now walks five test orders through every rule —
   stepping back included — and ends in the same error on purpose:

   > ALL GOOD -- every check passed, and nothing was saved

---

## 10. Reviews — 2 min

Since 8 November 2026 a customer can rate a delivered order — the delivery,
and each product — and every product page shows its average and its
reviews. Until the database has it, nothing asks for a rating and no
product shows one; the store's Reviews tab says what to run.

1. [SQL Editor](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/sql/new)
   → paste **all** of [`db/schema.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/schema.sql)
   → **Run** → *"Success. No rows returned."* It adds the two review
   tables and their functions, and lets a visitor with no account read
   one thing: the stars, the words, a first name and an initial. Nothing
   that exists is lost.
2. A new SQL tab → paste **all** of
   [`db/selftest.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/selftest.sql)
   → **Run**. It now walks six test orders through every rule — reviews
   included — and ends in the same error on purpose:

   > ALL GOOD -- every check passed, and nothing was saved

## 11. Products, prices, stock and photographs — 2 min

Since 8 November 2026 the products live in the database, and the store
page adds them, changes their prices and photographs, and keeps the
stock of every colour in every size: the **Products** and **Inventory**
tabs. Until this is run the shop shows the products from the site's own
file, and those two tabs say what to run.

1. [SQL Editor](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/sql/new)
   → paste **all** of [`db/schema.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/schema.sql)
   → **Run** → *"Success. No rows returned."* It adds the products
   table and puts the 11 products from your photographs into it — once:
   run again later, it leaves every product as the store left it. It
   makes a storage bucket, `product-photos`, that anybody may look at and
   only the store may add to, and from then on **every order is checked
   against today's prices and stock**, and takes its pieces off.
2. A new SQL tab → paste **all** of
   [`db/selftest.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/selftest.sql)
   → **Run**. It now also adds a test product, tries everything the
   store and a stranger might do to it, and places test orders against
   it — and ends in the same error on purpose, saving nothing:

   > ALL GOOD -- every check passed, and nothing was saved

3. Open the store page → **Products**: your 11 products. Change one
   price, then look at it in the shop.

## 12. Disable, delete, stock modes, and "notify me" — 2 min

Since 9 November 2026 each product is **on sale, disabled** (still found
by search, shown as out of stock), **a draft**, or **deleted** (kept, and
can be brought back); its stock is **always in stock** — every product,
to begin with — **out of stock**, or **counted** by colour and size. A
customer who signs in can ask to be told when something is back, and is
emailed once it is; every customer is emailed when their order moves.

1. [SQL Editor](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/sql/new)
   → paste **all** of [`db/schema.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/schema.sql)
   → **Run** → *"Success. No rows returned."* If it warns about a
   destructive operation, **Run this query**: it replaces the shop's own
   rules and deletes no data. It sets every product to *always in stock*.
   A line beginning **EMAILS:** means a Supabase switch is off — do what it
   says, then run the file again.
2. A new SQL tab → paste **all** of
   [`db/selftest.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/selftest.sql)
   → **Run**. The red box should begin:

   > ALL GOOD -- every check passed, and nothing was saved.

   and end by saying whether emails are ready — *"not set up yet"* until
   step 13.

## 13. Emails to customers — 5 min

The database sends them itself, through the same Brevo account that
sends the sign-in codes. It needs a Brevo **API** key — a different key
from the SMTP one in step 7b.

1. [Brevo](https://app.brevo.com) → your name (top right) → **SMTP & API**
   → **API Keys** tab → **Generate a new API key** → name it
   `vastra-emails` → copy it. It starts with `xkeysib-`.
2. [SQL Editor](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/sql/new)
   → paste **all** of [`db/email.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/email.sql).
   Then, **in the editor** (never in the file), replace the two
   `CHANGE-ME`s: the key on the `api_key` line, and on the `sender` line
   the address the sign-in codes come from. **Run.**
3. It says *"Saved. A test email is on its way"*. Look in that inbox — and
   its spam folder — for **"Customer emails are set up"**. Not there after a
   few minutes? Open the store's **Overview**: under *Emails to customers*
   the test shows Brevo's answer. If Brevo emailed you about an
   **unrecognised IP address**, it has blocked the database: approve that
   address in Brevo (**Security → Authorised IPs**), then run `db/email.sql`
   again.
4. Run `db/selftest.sql` again: it should now end **"Emails: ready."**
5. The store's **Overview** shows every email sent, and Brevo's answer.

To change the key or the address later, run `db/email.sql` again.

## Starting again with no data — 3 min

To clear out every test order and account and begin as a new customer
(the owner, 8 November 2026). ⚠️ **It cannot be undone**, and it
refuses to run after 9 November 2026 unless its LATCH date is changed
on purpose — so an old copy cannot empty a shop with real customers.

1. [SQL Editor](https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/sql/new) →
   paste **all** of [`db/reset.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/reset.sql)
   → **Run** → the editor warns that the query deletes rows → **Run
   this query**. It shows what is left: every count **0**, the next
   order **VA-0001**, the store code **kept**. If the accounts row says
   *NOT DELETED*, open **Authentication → Users**, tick them all, and
   delete them there. If it says *NOTHING DELETED: this is not the Vastra
   Apparel database*, the editor was open on another project — the name
   at the top left tells you which — and nothing anywhere was touched.
2. On every phone that used the shop: open it → the person icon →
   **Clear this browser**. Since 8 November 2026 the page notices by
   itself that its sign-in belongs to an account that is gone, and lets
   go of it; before that, the store code failed with *staff_user_id_fkey*.
3. Open the store page — reload it if it was already open — and type
   the store code again: the reset took every phone out of the store,
   and keeps the code itself. ⚠️ **A store page that still shows orders
   after a reload means the reset did not run on this project.**
4. Shop as a new customer: the first order is **VA-0001**.

## Renaming the shop, later

Order codes are the shop name's initials — `VA-0001` for Vastra Apparel
— written in two places: `domain.js` derives them from `brand.name`,
and `schema.sql` spells them in a generated column, because a column
cannot read a JSON file. `tools/db.pl` fails when the two disagree.

To change the letters on a project that already exists:

```sql
alter table orders drop column code;
alter table orders add column code text
  generated always as ('NEW-' || lpad(seq::text, 4, '0')) stored;
```

⚠️ **Only while the table is EMPTY.** Recreating the column recomputes
every row: an order a customer knows as VA-0005 would become NEW-0005,
and the code they read down the phone would no longer exist.

## Turning a phone out of the store

```sql
delete from staff;            -- every phone, then set a new code (step 3)
```

## What it costs

Nothing on the free plan. ⚠️ **A free project pauses after a week with
no activity** and must be restored by hand from the dashboard: a quiet
fortnight of testing will hit it, a shop taking orders daily will not.

## What is still true afterwards

- **The server re-adds every total and, since step 11, checks every
  price and the stock** against the products table -- refusing anything
  disabled or out of stock, and for stock that is counted, taking the
  pieces off as the order is placed and putting them back when the store
  cancels an item. ⚠️ **It does not check the coupon**: the coupons are
  in `app/data/shop.json`, which the database has never seen, so a
  request made by hand could name its own discount. The store page flags
  an order whose discount its coupon would not give.
- **A returned item's stock is not put back by itself** — somebody looks
  at it first, then adds it in the store's Inventory.
- **Emails need step 13.** Until the Brevo key is in, every email a
  customer is owed waits, and goes once it is. Brevo's free plan sends 300
  a day.
- **`paid` is a note a person makes**, after looking at the bank. UPI
  sends nothing back to a web page.
- **A customer sees their orders only in the browser they ordered from**,
  unless they sign in (step 7). Signed in, every phone shows them.
