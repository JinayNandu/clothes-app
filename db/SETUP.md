# Putting this shop on its own database

Until this is done the shop runs as it always has: everything in one
browser, and **an order placed on a customer's phone never reaches the
store page**. This fixes exactly that.

The site stays on GitHub Pages. Supabase is only the database behind
it: no server to run, no monthly bill.

Followed from Milan's `kirana/db/SETUP.md`, which has been walked end
to end — but this is **its own project**. Not Milan's, not DEVI's.

Every dashboard link below contains `_`, which Supabase turns into your
project once you are signed in.

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

[SQL Editor](https://supabase.com/dashboard/project/_/sql/new) → paste
**all** of [`db/schema.sql`](https://github.com/JinayNandu/clothes-app/blob/main/db/schema.sql)
→ **Run**. Expect *"Success. No rows returned."* It is safe to run again.

It makes the orders, their lines, the staff list and the store-code
lock, and the rules for who may read what. Nobody — customer or store —
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

[Authentication → Sign In / Providers](https://supabase.com/dashboard/project/_/auth/providers)
→ **Allow anonymous sign-ins: on.**

Every customer gets a quiet session at the moment they place an order,
so nobody is asked to sign in to buy a shirt, and every order still has
an owner the rules can check. Email sign-in, and the six-digit code it
sends, is the next step and needs Brevo; nothing to do for it yet.

## 5. Send two values — 1 min

[Settings → API Keys](https://supabase.com/dashboard/project/_/settings/api-keys/)

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

---

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

- **The server re-adds every total but does not know the prices.** The
  catalogue lives in `app/data/`, not in the database, so a request made
  by hand could name its own price. The store page flags any order whose
  prices differ from the catalogue. A price check on the server comes
  before taking money from strangers.
- **`paid` is a note a person makes**, after looking at the bank. UPI
  sends nothing back to a web page.
- **A customer sees their orders only in the browser they ordered from**,
  until email sign-in lands.
- **Stock is not taken off** when an order is placed.
