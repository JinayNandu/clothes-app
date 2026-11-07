-- =====================================================================
--  Vastra Apparel -- the database
--
--  Paste the whole file into the Supabase SQL editor and run it. It is
--  safe to run twice: the second run changes nothing.
--
--  This is its OWN Supabase project, not Milan's and not DEVI's. The
--  shapes were learned on Milan's (kirana/db/schema.sql); the data and
--  the project are this shop's alone.
--
--  ---------------------------------------------------------------
--  WHAT IS NOT HERE
--
--  The catalogue. Products, prices, sizes, coupons and the delivery
--  rule stay in app/data/*.json, in git, checked by tools/data.pl and
--  the same for everybody. What is here is only what moves per person:
--  orders, their lines, a signed-in customer's addresses, and who may
--  run the store.
--
--  ---------------------------------------------------------------
--  NOBODY WRITES A TABLE DIRECTLY
--
--  Every write is a function below, which can do its one thing and
--  nothing else. Milan's lets a customer INSERT into orders, and its
--  policy checks only the owner -- so a hand-made request can create an
--  order already marked paid and delivered. Here a customer can only
--  call place_order(), which sets status, paid and the owner itself,
--  writes the order and its lines in ONE transaction, and re-adds every
--  total rather than trusting the page's arithmetic.
--
--  ⚠️ WHAT IT DOES NOT YET CHECK: the PRICES themselves. The server has
--  no copy of the catalogue, so a forged request could name its own
--  unit prices and coupon. The store page flags any order whose prices
--  differ from the catalogue; a price check on the server comes before
--  this shop takes money from strangers. See CLAUDE.md, *Open*.
--
--  ---------------------------------------------------------------
--  THE ADDRESS IS COPIED INTO THE ORDER, never referenced. An address
--  changed next month must not rewrite where last week's parcel went.
-- =====================================================================

-- Supabase keeps extensions in their own schema. crypt() lives there.
create extension if not exists pgcrypto with schema extensions;

-- The one timestamp format this app reads: the same shape as the
-- browser's toISOString(), so history written here and history written
-- by the one-browser backend are the same strings.
create or replace function iso_now() returns text
  language sql stable set search_path = public as $fn$
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$fn$;

-- ---------------------------------------------------------------------
--  staff -- membership of this table IS the store page
--
--  Joined only through claim_staff() below, with the store code. Nothing
--  in the app can insert here any other way.
-- ---------------------------------------------------------------------
create table if not exists staff (
  user_id  uuid primary key references auth.users on delete cascade,
  added_at timestamptz not null default now()
);
alter table staff enable row level security;

-- SECURITY DEFINER so it can read `staff` without going back through
-- staff's own policy; without that every policy that calls it recurses
-- and Postgres refuses the query -- which looks exactly like "the store
-- cannot see any orders".
create or replace function is_staff() returns boolean
  language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from staff where user_id = auth.uid());
$fn$;

drop policy if exists staff_read on staff;
create policy staff_read on staff for select using (is_staff());

-- ---------------------------------------------------------------------
--  orders
--
--  The code is minted HERE, from a sequence, never counted in a browser:
--  two customers ordering in the same second on two phones is exactly
--  what a counter in localStorage cannot get right.
-- ---------------------------------------------------------------------
create sequence if not exists order_seq start 1;

create table if not exists orders (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint not null default nextval('order_seq'),
  -- ⚠️ THE LETTERS ARE THE INITIALS OF brand.name IN app/data/shop.json,
  -- exactly what domain.js orderPrefix() mints in one-browser mode. A
  -- generated column cannot read a JSON file, so it is written twice and
  -- tools/db.pl fails if the two drift. Renaming the shop on a table that
  -- already holds orders: see db/SETUP.md first.
  code         text generated always as ('VA-' || lpad(seq::text, 4, '0')) stored,
  user_id      uuid default auth.uid() references auth.users on delete set null,
  -- The same statuses as ORDER_NEXT in domain.js, less `draft`: an order
  -- that exists here has reached the shop. tools/db.pl checks the list.
  status       text not null default 'sent' check (status in
                 ('sent','confirmed','packed','shipped','delivered',
                  'returned','cancelled','abandoned')),
  placed_at    timestamptz not null default now(),

  -- The customer, SNAPSHOTTED. Lengths capped so a hand-made request
  -- cannot park a megabyte in somebody's order list.
  cust_name    text not null check (char_length(cust_name) between 2 and 80),
  cust_mobile  text not null check (char_length(cust_mobile) between 10 and 16),
  cust_email   text check (cust_email is null or char_length(cust_email) <= 120),
  addr         text not null check (char_length(addr) between 10 and 300),
  city         text not null check (char_length(city) between 1 and 60),
  state        text not null check (char_length(state) between 2 and 60),
  pin          text not null check (pin ~ '^[1-9][0-9]{5}$'),

  -- Integer rupees, as everywhere in this app.
  items_total  int  not null check (items_total > 0),
  mrp_total    int  not null,
  saved        int  not null default 0,
  coupon       text check (coupon is null or char_length(coupon) <= 40),
  discount     int  not null default 0 check (discount >= 0),
  shipping     int  not null default 0 check (shipping >= 0),
  bulky        int  not null default 0 check (bulky >= 0),
  grand        int  not null check (grand >= 0),
  pay_method   text not null check (pay_method in ('upi','cod')),

  paid         boolean not null default false,
  paid_at      timestamptz,
  paid_via     text,

  -- THE DELIVERY PROMISE, frozen as the order arrives and never moved.
  arrives_from date not null,
  arrives_to   date not null,
  arrives_rule jsonb,
  shipment     jsonb,
  delivered_at timestamptz,
  history      jsonb not null default '[]'::jsonb,
  check (arrives_to >= arrives_from)
);
create index if not exists orders_user   on orders (user_id, placed_at desc);
create index if not exists orders_placed on orders (placed_at desc);
alter table orders enable row level security;

create table if not exists order_lines (
  id            bigserial primary key,
  order_id      uuid not null references orders on delete cascade,
  pid           text not null,
  name          text not null,
  slug          text,
  variant       jsonb not null default '{}'::jsonb,
  variant_label text,
  qty           int  not null check (qty between 1 and 10),
  unit_price    int  not null check (unit_price > 0),
  unit_mrp      int  not null,
  line_total    int  not null,
  check (line_total = unit_price * qty),
  check (unit_mrp >= unit_price)
);
create index if not exists order_lines_order on order_lines (order_id);
alter table order_lines enable row level security;

-- You see your own orders. The store sees all of them. Nobody sees
-- anybody else's. There is no insert, update or delete policy on either
-- table: every write is one of the functions below.
drop policy if exists ord_read on orders;
create policy ord_read on orders for select
  using (user_id = auth.uid() or is_staff());

drop policy if exists line_read on order_lines;
create policy line_read on order_lines for select using (
  exists (select 1 from orders o where o.id = order_id
          and (o.user_id = auth.uid() or is_staff()))
);

-- ---------------------------------------------------------------------
--  place_order(p) -- the customer's one write, and the only way an
--  order comes into being.
--
--  It sets for itself everything a customer must not choose: who owns
--  the order, its status, that it is unpaid, the time. It re-adds the
--  lines and checks the totals add up, and writes the order and its
--  lines together -- one fails, neither exists. Milan's two separate
--  inserts could leave an order with no lines behind, and the cleanup
--  meant to remove it needed a DELETE right the customer did not have.
-- ---------------------------------------------------------------------
create or replace function place_order(p jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  c         jsonb := p->'customer';
  item      jsonb;
  q         int;
  up        int;
  um        int;
  items     int := 0;
  mrp       int := 0;
  disc      int := coalesce((p->>'discount')::int, 0);
  ship      int := coalesce((p->>'shipping')::int, 0);
  bulk      int := coalesce((p->>'bulky')::int, 0);
  a_from    date := (p->'arrives'->>'from')::date;
  a_to      date := (p->'arrives'->>'to')::date;
  today     date := (now() at time zone 'Asia/Kolkata')::date;
  stamp     text := iso_now();
  new_id    uuid;
  new_code  text;
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;

  -- No captcha in front of this, so a ceiling instead: five orders an
  -- hour is a busy customer; fifty is a script.
  if (select count(*) from orders
       where user_id = auth.uid() and placed_at > now() - interval '1 hour') >= 5 then
    raise exception 'TOO_MANY_ORDERS';
  end if;

  -- Two checks, not one with an OR: SQL does not promise to test the left
  -- side first, and jsonb_array_length() of a non-array is an error of its
  -- own rather than this refusal.
  if jsonb_typeof(p->'lines') is distinct from 'array' then raise exception 'BAD_LINES'; end if;
  if jsonb_array_length(p->'lines') not between 1 and 20 then raise exception 'BAD_LINES'; end if;

  -- ⚠️ coalesce() before every test. A missing number is NULL, a test on
  -- NULL is neither true nor false, and an IF reads "unknown" as false -- so
  -- without it a line with no price would walk past every check here.
  for item in select value from jsonb_array_elements(p->'lines') loop
    q  := coalesce((item->>'qty')::int, 0);
    up := coalesce((item->>'unitPrice')::int, 0);
    um := coalesce((item->>'unitMrp')::int, 0);
    if q not between 1 and 10 or up <= 0 or um < up then raise exception 'BAD_LINE'; end if;
    items := items + up * q;
    mrp   := mrp   + um * q;
  end loop;

  -- Re-added, never taken on trust. `is distinct from`, so a total that is
  -- missing is refused rather than waved through as unknown.
  if items is distinct from (p->>'itemsTotal')::int then raise exception 'ITEMS_DO_NOT_ADD_UP'; end if;
  if disc < 0 or disc > items or ship < 0 or bulk < 0 then raise exception 'BAD_TOTALS'; end if;
  if (p->>'grand')::int is distinct from items - disc + ship + bulk then
    raise exception 'TOTAL_DOES_NOT_ADD_UP';
  end if;

  -- The promise is worked out by the page from shop.json's delivery rule
  -- (domain.js arrivalPromise) and frozen here. The server cannot read
  -- the rule, so it refuses only what no rule could produce: a date
  -- already past, a range running backwards, or one two months out.
  if a_from is null or a_to is null or a_from < today
     or a_to < a_from or a_to > today + 60 then
    raise exception 'BAD_PROMISE';
  end if;

  insert into orders (
    user_id, status, cust_name, cust_mobile, cust_email, addr, city, state, pin,
    items_total, mrp_total, saved, coupon, discount, shipping, bulky, grand,
    pay_method, paid, arrives_from, arrives_to, arrives_rule, history)
  values (
    auth.uid(), 'sent', c->>'name', c->>'mobile', nullif(c->>'email', ''),
    c->>'addr', c->>'city', c->>'state', c->>'pin',
    items, mrp, greatest(0, mrp - items), nullif(p->>'coupon', ''),
    disc, ship, bulk, items - disc + ship + bulk,
    p->>'payMethod', false, a_from, a_to,
    jsonb_build_object('minDays', (p->'arrives'->>'minDays')::int,
                       'maxDays', (p->'arrives'->>'maxDays')::int,
                       'countedFrom', p->'arrives'->>'countedFrom'),
    jsonb_build_array(jsonb_build_object('at', stamp, 'to', 'sent', 'note', 'placed online')))
  returning id, code into new_id, new_code;

  insert into order_lines (order_id, pid, name, slug, variant, variant_label,
                           qty, unit_price, unit_mrp, line_total)
  select new_id, l->>'pid', l->>'name', l->>'slug', coalesce(l->'variant', '{}'::jsonb),
         l->>'variantLabel', (l->>'qty')::int, (l->>'unitPrice')::int,
         (l->>'unitMrp')::int, (l->>'unitPrice')::int * (l->>'qty')::int
    from jsonb_array_elements(p->'lines') as t(l);

  return jsonb_build_object('id', new_id, 'code', new_code);
end;
$fn$;

-- ---------------------------------------------------------------------
--  advance_order -- the store moves an order along. Staff only.
--
--  The road is checked HERE, not just by the buttons the board draws:
--  a request made by hand must not skip from sent to delivered. The
--  delivery stamp is written the moment an order becomes delivered,
--  because the seven-day return window counts from it.
-- ---------------------------------------------------------------------
create or replace function advance_order(p_oid uuid, p_to text,
                                         p_courier text default null,
                                         p_ref text default null)
  returns void language plpgsql volatile security definer set search_path = public as $fn$
declare
  cur   text;
  stamp text := iso_now();
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  select status into cur from orders where id = p_oid for update;
  if cur is null then raise exception 'NO_SUCH_ORDER'; end if;
  -- A NULL step would test as unknown below and slip past the list.
  if p_to is null then raise exception 'BAD_TRANSITION'; end if;

  -- ⚠️ THE ROAD, WRITTEN A SECOND TIME: the same pairs as ORDER_NEXT in
  -- app/domain.js, less the draft, which never reaches this database.
  -- tools/db.pl fails if the two lists drift.
  if (cur, p_to) not in (
    ('sent', 'confirmed'), ('sent', 'abandoned'),
    ('confirmed', 'packed'), ('confirmed', 'cancelled'),
    ('packed', 'shipped'), ('packed', 'cancelled'),
    ('shipped', 'delivered'), ('shipped', 'returned'),
    ('delivered', 'returned')
  ) then
    raise exception 'BAD_TRANSITION % -> %', cur, p_to;
  end if;

  update orders set
    status       = p_to,
    history      = history || jsonb_build_array(jsonb_build_object('at', stamp, 'to', p_to)),
    delivered_at = case when p_to = 'delivered' then stamp::timestamptz else delivered_at end,
    shipment     = case
      when p_to = 'shipped'
       and (coalesce(trim(p_courier), '') <> '' or coalesce(trim(p_ref), '') <> '')
      then jsonb_build_object('courier', left(coalesce(trim(p_courier), ''), 60),
                              'ref',     left(coalesce(trim(p_ref), ''), 60))
      else shipment end
  where id = p_oid;
end;
$fn$;

-- ---------------------------------------------------------------------
--  set_paid -- a person at the shop says the money has arrived. Staff
--  only. Nothing in this app can observe a UPI payment: there is no
--  callback to a static page, so this is a note somebody makes after
--  looking at the bank, and it says so.
-- ---------------------------------------------------------------------
create or replace function set_paid(p_oid uuid, p_paid boolean, p_via text default null)
  returns void language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  if p_paid is null then raise exception 'BAD_PAID'; end if;
  update orders set
    paid     = p_paid,
    paid_at  = case when p_paid then now() else null end,
    paid_via = case when p_paid then left(coalesce(p_via, 'checked by hand'), 60) else null end
  where id = p_oid;
  if not found then raise exception 'NO_SUCH_ORDER'; end if;
end;
$fn$;

-- ---------------------------------------------------------------------
--  THE STORE CODE, checked where it can decide something.
--
--  A code checked in the browser decides only whether a button is
--  drawn -- and this repository is public, so it would be a code anyone
--  could read. claim_staff() checks it HERE, against a bcrypt hash, and
--  on a match puts the CALLING session into `staff`. That session then
--  sees every order; no other does. The code itself is set by
--  db/store-code.sql, typed into the SQL editor and never into a file.
--
--  The code is a real credential: it opens every customer's name, phone
--  and address. Length is the defence that counts, so store-code.sql
--  refuses anything under eight characters, and five tries an hour per
--  session is the ceiling here.
-- ---------------------------------------------------------------------
create table if not exists shop_secret (
  id        int primary key default 1,
  code_hash text        not null,
  set_at    timestamptz not null default now(),
  constraint shop_secret_one_row check (id = 1)
);
alter table shop_secret enable row level security;
-- Deliberately NO policy: nothing reaches this table but the function.

create table if not exists claim_attempts (
  user_id  uuid        not null,
  tried_at timestamptz not null default now()
);
create index if not exists claim_attempts_user on claim_attempts (user_id, tried_at desc);
alter table claim_attempts enable row level security;
-- No policy either.

create or replace function claim_staff(p_code text) returns boolean
  -- ⚠️ `extensions` IS LOAD-BEARING. pgcrypto lives there on Supabase,
  -- and a SECURITY DEFINER function pins its own search_path: with
  -- `public` alone, crypt() is invisible INSIDE this function while
  -- working perfectly in the SQL editor. Milan's learned this at the
  -- counter.
  language plpgsql volatile security definer
  set search_path = public, extensions as $fn$
declare hash text;
begin
  if auth.uid() is null then return false; end if;

  if (select count(*) from claim_attempts
       where user_id = auth.uid() and tried_at > now() - interval '1 hour') >= 5 then
    raise exception 'TOO_MANY_TRIES';
  end if;
  insert into claim_attempts (user_id) values (auth.uid());

  select code_hash into hash from shop_secret where id = 1;
  if hash is null then return false; end if;
  -- crypt() re-derives with the salt inside the stored hash: a bcrypt
  -- compare, not a string match.
  if hash <> crypt(p_code, hash) then return false; end if;

  insert into staff (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  delete from claim_attempts where user_id = auth.uid();
  return true;
end;
$fn$;

-- ---------------------------------------------------------------------
--  SIGNED-IN CUSTOMERS (step 7)
--
--  Nobody has to sign in to buy. A customer who wants their orders on a
--  second phone, or an address kept, signs in with an email and a
--  six-digit code -- never a password. Supabase sends and checks the
--  code; this file has three jobs: tell a guest from an account, keep
--  each account's addresses to itself, and let a guest's orders follow
--  them into an account they already had.
--
--  A GUEST is an anonymous session: the quiet one a phone gets as it
--  places its first order. Signing in on THAT phone attaches the email
--  to the same user -- Supabase calls it an email change -- so its
--  orders are already the account's and nothing moves. Only when the
--  email already belongs to an account (signed in on another phone
--  before) does this phone sign in AS that account and become another
--  user; then its guest orders are handed across, by the two hand-over
--  functions further down.
-- ---------------------------------------------------------------------

-- A real account with an email, not an anonymous session. Read from
-- auth.users rather than the token, so a token minted before the email
-- was attached can claim no more than the user now is.
create or replace function signed_in() returns boolean
  language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from auth.users u
                  where u.id = auth.uid() and u.email is not null
                    and not coalesce(u.is_anonymous, false));
$fn$;

-- ---------------------------------------------------------------------
--  addresses -- a signed-in customer's address book
--
--  Copied INTO an order at checkout, never referenced by one (top of
--  this file). Only accounts keep one: a guest's details stay in their
--  own browser, as before, so the server holds no address book for a
--  session nobody can come back to. The store has no read on this table
--  at all -- it sees the address each ORDER went to, which is all it
--  needs.
-- ---------------------------------------------------------------------
create table if not exists addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text not null check (char_length(name) between 2 and 80),
  mobile      text not null check (char_length(mobile) between 10 and 16),
  addr        text not null check (char_length(addr) between 10 and 300),
  city        text not null check (char_length(city) between 1 and 60),
  state       text not null check (char_length(state) between 2 and 60),
  pin         text not null check (pin ~ '^[1-9][0-9]{5}$'),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists addresses_user on addresses (user_id, created_at desc);
alter table addresses enable row level security;

drop policy if exists addr_read on addresses;
create policy addr_read on addresses for select using (user_id = auth.uid());

-- Add one (no id) or change one of your own (with its id). Ten is the
-- ceiling: a family's worth, and not a place to park rows by the
-- thousand. The first address is the default whatever the page asked;
-- isDefault moves the default to this one.
create or replace function save_address(p jsonb) returns uuid
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  aid uuid    := nullif(p->>'id', '')::uuid;
  mk  boolean := coalesce((p->>'isDefault')::boolean, false);
begin
  if not signed_in() then raise exception 'NOT_SIGNED_IN'; end if;
  if aid is null then
    if (select count(*) from addresses where user_id = auth.uid()) >= 10 then
      raise exception 'TOO_MANY_ADDRESSES';
    end if;
    mk := mk or not exists (select 1 from addresses where user_id = auth.uid());
    insert into addresses (user_id, name, mobile, addr, city, state, pin)
    values (auth.uid(), trim(p->>'name'), trim(p->>'mobile'), trim(p->>'addr'),
            trim(p->>'city'), trim(p->>'state'), trim(p->>'pin'))
    returning id into aid;
  else
    update addresses set
      name = trim(p->>'name'), mobile = trim(p->>'mobile'), addr = trim(p->>'addr'),
      city = trim(p->>'city'), state = trim(p->>'state'), pin = trim(p->>'pin'),
      updated_at = now()
    where id = aid and user_id = auth.uid();
    if not found then raise exception 'NO_SUCH_ADDRESS'; end if;
  end if;
  if mk then
    update addresses set is_default = (id = aid) where user_id = auth.uid();
  end if;
  return aid;
end;
$fn$;

create or replace function set_default_address(p_id uuid) returns void
  language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not signed_in() then raise exception 'NOT_SIGNED_IN'; end if;
  if not exists (select 1 from addresses where id = p_id and user_id = auth.uid()) then
    raise exception 'NO_SUCH_ADDRESS';
  end if;
  update addresses set is_default = (id = p_id) where user_id = auth.uid();
end;
$fn$;

-- Gone for good. If it was the default, the newest one left takes over,
-- so checkout always has one to offer first.
create or replace function delete_address(p_id uuid) returns void
  language plpgsql volatile security definer set search_path = public as $fn$
declare was boolean;
begin
  if not signed_in() then raise exception 'NOT_SIGNED_IN'; end if;
  delete from addresses where id = p_id and user_id = auth.uid()
    returning is_default into was;
  if not found then raise exception 'NO_SUCH_ADDRESS'; end if;
  if was then
    update addresses set is_default = true
     where id = (select id from addresses where user_id = auth.uid()
                  order by created_at desc limit 1);
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------
--  handovers -- a guest's orders, carried into the account they sign
--  in to.
--
--  The case it is for: somebody with an account (they signed in on
--  another phone once) orders on this phone as a guest, then signs in.
--  The email is taken, so this phone cannot become that account by an
--  email change; it signs in to it instead and becomes a different
--  user -- and the orders it placed would vanish from view the moment
--  it did.
--
--  The proof that those orders are theirs to move is a TICKET, made
--  while this phone is still the guest: a random token only this browser
--  ever held, good for one use within the hour. Handing over by user id
--  instead would let anyone who learned a guest's id take its orders.
--  Only a hash of the token is kept.
-- ---------------------------------------------------------------------
create table if not exists handovers (
  token_hash text primary key,
  from_user  uuid        not null,
  made_at    timestamptz not null default now(),
  taken_at   timestamptz
);
create index if not exists handovers_from on handovers (from_user, made_at desc);
alter table handovers enable row level security;
-- No policy: nothing reaches this table but the two functions.

-- ⚠️ `extensions` in the search path, as in claim_staff(): pgcrypto's
-- gen_random_bytes() and digest() live there on Supabase.
create or replace function make_handover() returns text
  language plpgsql volatile security definer
  set search_path = public, extensions as $fn$
declare tok text;
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  if signed_in() then raise exception 'NOT_A_GUEST'; end if;
  if (select count(*) from handovers
       where from_user = auth.uid() and made_at > now() - interval '1 hour') >= 5 then
    raise exception 'TOO_MANY_TRIES';
  end if;
  tok := encode(gen_random_bytes(24), 'hex');
  insert into handovers (token_hash, from_user)
  values (encode(digest(tok, 'sha256'), 'hex'), auth.uid());
  return tok;
end;
$fn$;

create or replace function take_handover(p_token text) returns int
  language plpgsql volatile security definer
  set search_path = public, extensions as $fn$
declare
  src   uuid;
  moved int := 0;
begin
  if not signed_in() then raise exception 'NOT_SIGNED_IN'; end if;
  update handovers set taken_at = now()
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and taken_at is null and made_at > now() - interval '1 hour'
  returning from_user into src;
  -- Used, expired or never made: nothing to carry, and nothing said
  -- about which.
  if src is null or src = auth.uid() then return 0; end if;
  -- From a guest only. A session that has since become an account of
  -- its own keeps its orders.
  if not exists (select 1 from auth.users where id = src and coalesce(is_anonymous, false)) then
    return 0;
  end if;
  update orders set user_id = auth.uid() where user_id = src;
  get diagnostics moved = row_count;
  return moved;
end;
$fn$;

-- ---------------------------------------------------------------------
--  Realtime: the board ticks when an order arrives, and a customer's
--  order page moves when the store marks it packed. RLS is applied per
--  subscriber, so a customer's socket carries only their own orders.
-- ---------------------------------------------------------------------
do $pub$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'orders') then
    alter publication supabase_realtime add table orders;
  end if;
end $pub$;

-- =====================================================================
--  WHO MAY TOUCH WHAT AT ALL
--
--  A SECOND layer, and not the same as the policies above:
--
--    GRANT   -- may this role reach the table or function at all
--    POLICY  -- which ROWS of a table it may see
--
--  A table with perfect policies and no grant answers every query with
--  "permission denied". A table with a grant and no policy answers with
--  nothing at all. Both are needed, and only policies show in the table
--  editor -- which is why everything is revoked first and then granted
--  by name, whatever the project's "expose new tables" setting did.
--
--  Only `authenticated`, never `anon`: a customer gets a session (an
--  anonymous one) before their first order, so `anon` is the role of a
--  session that does not exist yet, and it needs nothing here.
--
--  ⚠️ Postgres lets EVERYONE execute a new function unless told
--  otherwise, and a SECURITY DEFINER function runs with its owner's
--  rights. So each one is revoked from public, anon and authenticated
--  before the one grant it should have. tools/db.pl checks there is a
--  revoke for every function in this file.
-- =====================================================================
revoke all on table staff, orders, order_lines, shop_secret, claim_attempts,
                    addresses, handovers
  from anon, authenticated;
revoke all on sequence order_seq, order_lines_id_seq from anon, authenticated;

grant usage on schema public to authenticated;
grant select on staff, orders, order_lines, addresses to authenticated;

revoke all on function iso_now()                              from public, anon, authenticated;
revoke all on function is_staff()                             from public, anon, authenticated;
revoke all on function place_order(jsonb)                     from public, anon, authenticated;
revoke all on function advance_order(uuid, text, text, text)  from public, anon, authenticated;
revoke all on function set_paid(uuid, boolean, text)          from public, anon, authenticated;
revoke all on function claim_staff(text)                      from public, anon, authenticated;
revoke all on function signed_in()                            from public, anon, authenticated;
revoke all on function save_address(jsonb)                    from public, anon, authenticated;
revoke all on function set_default_address(uuid)              from public, anon, authenticated;
revoke all on function delete_address(uuid)                   from public, anon, authenticated;
revoke all on function make_handover()                        from public, anon, authenticated;
revoke all on function take_handover(text)                    from public, anon, authenticated;

-- is_staff() runs inside the read policies, so the reader must be
-- allowed to call it. The rest are the only writes there are.
-- signed_in() is granted to nobody: it is only ever called from inside
-- the functions above, which run as their owner.
grant execute on function is_staff()                            to authenticated;
grant execute on function place_order(jsonb)                    to authenticated;
grant execute on function advance_order(uuid, text, text, text) to authenticated;
grant execute on function set_paid(uuid, boolean, text)         to authenticated;
grant execute on function claim_staff(text)                     to authenticated;
grant execute on function save_address(jsonb)                   to authenticated;
grant execute on function set_default_address(uuid)             to authenticated;
grant execute on function delete_address(uuid)                  to authenticated;
grant execute on function make_handover()                       to authenticated;
grant execute on function take_handover(text)                   to authenticated;
