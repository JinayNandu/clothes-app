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
--  WHAT IS HERE, AND WHAT IS NOT
--
--  What moves per person -- orders, their lines, a signed-in customer's
--  addresses, reviews, who may run the store -- and, since 8 November
--  2026, THE CATALOGUE: products, their prices, the stock of each colour
--  in each size, and their photographs, which the store page changes.
--  The first catalogue is app/data/catalog.json, copied into an empty
--  products table at the end of this file (tools/seed.pl writes that
--  part). Categories, size charts, coupons and the delivery rule stay in
--  app/data/*.json, in git, checked by tools/data.pl.
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
--  Since 8 November 2026 it also checks every line against TODAY'S
--  catalogue -- the price for that size, a colour and size it sells, in
--  stock -- and takes the stock off. ⚠️ WHAT IT STILL DOES NOT CHECK: the
--  COUPON. The coupons are in shop.json, which this database has never
--  seen, so a forged request could still name its own discount. The
--  store page flags one; see CLAUDE.md, *Open*.
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

-- ---------------------------------------------------------------------
--  EACH ITEM HAS ITS OWN STATUS (7 November 2026, the owner's ask)
--
--  The store can move one item on its own -- pack the kurti while the
--  dress waits -- or cancel one item and send the rest. The ORDER's
--  status is then where its slowest item still on its way is (see
--  roll_up_order below): "packed" means every item not cancelled is
--  packed. Moving the whole order moves every item with it.
--
--  Added with `if not exists`, so this file still runs twice safely, and
--  an order placed before today gets its items' statuses from the order
--  itself, once, below.
-- ---------------------------------------------------------------------
alter table order_lines add column if not exists status   text  not null default 'sent';
alter table order_lines add column if not exists history  jsonb not null default '[]'::jsonb;
alter table order_lines add column if not exists shipment jsonb;
do $chk$
begin
  -- ⚠️ THE SAME LIST AS LINE_NEXT's keys in app/domain.js; tools/db.pl
  -- compares them. An item is never a draft and never "abandoned".
  if not exists (select 1 from pg_constraint where conname = 'order_lines_status_ok') then
    alter table order_lines add constraint order_lines_status_ok check (status in
      ('sent','confirmed','packed','shipped','delivered','returned','cancelled'));
  end if;
end $chk$;

-- Items of an order placed before today take the order's status. Only
-- items still at the default under an order that moved on are touched, so
-- a second run of this file changes nothing.
update order_lines l
   set status = case when o.status in ('cancelled', 'abandoned') then 'cancelled' else o.status end
  from orders o
 where l.order_id = o.id and l.status = 'sent' and o.status <> 'sent';

-- What the order cost as placed (the discount shrinks in proportion when
-- an item is cancelled, and is worked out from this, never from itself),
-- what was paid (so a cancellation after payment knows what is owed
-- back), what has been refunded, and when the order last changed (every
-- write touches it, so a customer's page follows an item's move live).
alter table orders add column if not exists discount_placed int;
update orders set discount_placed = discount where discount_placed is null;
alter table orders add column if not exists paid_amount int;
update orders set paid_amount = grand where paid and paid_amount is null;
alter table orders add column if not exists refunded    int not null default 0;
alter table orders add column if not exists refunded_at timestamptz;
alter table orders add column if not exists updated_at  timestamptz not null default now();

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

-- =====================================================================
--  THE CATALOGUE (8 November 2026) -- products, the stock of each colour
--  in each size, and their photographs, which the store page now changes
--  itself. Until today they were JSON in git, and the owner could not
--  change a price without somebody editing a file.
--
--  NOBODY READS OR WRITES THE TABLE DIRECTLY, like every table here. Two
--  functions read it -- catalogue() for everybody, with no session, and
--  store_products() for the store -- and five write it, each the store's
--  alone: save_product, set_price, set_stock, set_status and set_stock_mode.
--
--  ⚠️ place_order() READS IT TOO, and that is the point. Before today the
--  server had never seen a price, so a hand-made order could name its
--  own. Now every line must carry today's price for its size, and the
--  stock of that colour and size is taken off as the order is placed --
--  the row locked first, so two phones cannot both buy the last one. A
--  cancelled item puts its stock back (restock_line).
--
--  A PRODUCT IS NEVER DELETED, only hidden: it may sit in somebody's bag,
--  wishlist or order, and all three find it by id.
--
--  The JSON the app knows is made in ONE place, product_json(), so the
--  table's snake_case never leaves this file.
-- =====================================================================
create table if not exists products (
  id          text primary key check (id ~ '^p-[a-z0-9-]{1,60}$'),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  name        text not null check (length(name) between 1 and 120),
  cat         text not null,
  sub         text,
  price       int  not null check (price > 0),
  mrp         int  not null,
  short_desc  text not null default '',
  descr       text not null default '',
  specs       jsonb not null default '[]'::jsonb,
  variants    jsonb not null default '{}'::jsonb,
  img         jsonb not null default '[]'::jsonb,
  -- The stock of each colour in each size: {"sage/m": 4}. A product with
  -- one axis keys by it alone, one with neither by "one" (sku_key).
  skus        jsonb not null default '{}'::jsonb,
  badges      jsonb not null default '[]'::jsonb,
  tags        jsonb not null default '[]'::jsonb,
  size_chart  text,
  kind        text not null default 'goods' check (kind in ('goods', 'voucher')),
  ship_class  text not null default 'std'   check (ship_class in ('std', 'bulky')),
  popularity  int  not null default 50 check (popularity between 0 and 100),
  added_on    date not null default ((now() at time zone 'Asia/Kolkata')::date),
  hidden      boolean not null default false,
  -- The order the shop lists them in; a new product goes last.
  list_order  int  not null default 0,
  updated_at  timestamptz not null default now(),
  check (mrp >= price)
);
-- Row-level security on and NO policy: no role sees a row except through
-- the functions below, which run as their owner.
alter table products enable row level security;

-- THE STORE'S CONTROLS ON A PRODUCT (9 November 2026, the owner: "keep
-- 'infinite stock' 'out of stock' 'disable' 'delete' etc etc options for
-- the back end").
--   DISABLED  no longer sold, but still found by search and by its link,
--             shown as out of stock, and a customer may ask to be told if
--             it comes back (interest, below).
--   DELETED   gone from the shop and from the store's list -- kept, so a
--             past order or a bag still finds it, and the store can bring
--             it back. `hidden` is a draft, not yet in the shop.
--   STOCK     'always' in stock -- every product, to begin with, the
--             owner's word -- 'out' of stock, or 'counted' by colour and
--             size in `skus`. Only counted stock is taken off by an order.
alter table products add column if not exists disabled   boolean not null default false;
alter table products add column if not exists deleted_at timestamptz;
alter table products add column if not exists stock_mode text not null default 'always'
  check (stock_mode in ('always', 'counted', 'out'));

-- What the server checked as an order was placed, line by line: today's
-- price (`checked`), and whether its stock was taken off (`stock_taken`,
-- false again once a cancellation has put it back). An item placed before
-- 8 November 2026 has neither, and the store board still checks it.
alter table order_lines add column if not exists checked     boolean not null default false;
alter table order_lines add column if not exists stock_taken boolean not null default false;

-- A whole number from JSON, or NULL: 12.5, "12" and true are not.
create or replace function whole(j jsonb) returns int
  language sql immutable set search_path = public as $fn$
  select case when jsonb_typeof(j) = 'number' and j::text ~ '^[0-9]{1,9}$' then j::text::int end;
$fn$;

-- The stock key of a chosen variant -- the same as domain.js skuKey().
create or replace function sku_key(sel jsonb) returns text
  language sql immutable set search_path = public as $fn$
  select coalesce(nullif(concat_ws('/', nullif(sel->>'colour', ''), nullif(sel->>'size', '')), ''), 'one');
$fn$;

-- Every stock key a product's variants make, colour by colour, size by size.
create or replace function sku_keys(v jsonb) returns text[]
  language sql immutable set search_path = public as $fn$
  select case
    when n.nc > 0 and n.ns > 0 then array(
      select (c.e->>'id') || '/' || (s.e->>'id')
        from jsonb_array_elements(v->'colour') with ordinality as c(e, i)
       cross join jsonb_array_elements(v->'size') with ordinality as s(e, j)
       order by c.i, s.j)
    when n.nc > 0 then array(
      select c.e->>'id' from jsonb_array_elements(v->'colour') with ordinality as c(e, i) order by c.i)
    when n.ns > 0 then array(
      select s.e->>'id' from jsonb_array_elements(v->'size') with ordinality as s(e, j) order by s.j)
    else array['one'] end
  from (select jsonb_array_length(coalesce(v->'colour', '[]'::jsonb)) as nc,
               jsonb_array_length(coalesce(v->'size', '[]'::jsonb)) as ns) as n;
$fn$;

-- A product as the app knows it. `exact` is the store's view: every
-- piece of stock, and whether it is hidden. Everybody else sees stock up
-- to 10 -- enough to say "Only 2 left" and to stop the bag at what there
-- is (an order takes at most 10 of a line) -- and not the warehouse.
create or replace function product_json(p products, exact boolean) returns jsonb
  language sql stable set search_path = public as $fn$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'cat', p.cat, 'sub', p.sub,
    'price', p.price, 'mrp', p.mrp, 'shortDesc', p.short_desc, 'desc', p.descr,
    'specs', p.specs, 'variants', p.variants, 'img', p.img,
    'skus', case when exact then p.skus else (
              select coalesce(jsonb_object_agg(e.k, least(e.v::int, 10)), '{}'::jsonb)
                from jsonb_each_text(p.skus) as e(k, v)) end,
    'badges', p.badges, 'tags', p.tags, 'sizeChart', p.size_chart,
    'kind', p.kind, 'shipClass', p.ship_class, 'popularity', p.popularity,
    'addedOn', to_char(p.added_on, 'YYYY-MM-DD'),
    'status', case when p.deleted_at is not null then 'deleted' when p.hidden then 'hidden'
                   when p.disabled then 'disabled' else 'active' end,
    'stockMode', p.stock_mode));
$fn$;

-- What everybody may read: the products in the shop, in its order --
-- disabled ones too, marked so, since a search must still find them.
-- Granted to anon -- a page with no session -- like the public reviews.
create or replace function catalogue() returns jsonb
  language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(product_json(p, false) order by p.list_order, p.id), '[]'::jsonb)
    from products p where not p.hidden and p.deleted_at is null;
$fn$;

-- The store's view: every product, drafts and deleted ones too, with all
-- its stock, and how many customers are waiting to be told it is back.
create or replace function store_products() returns jsonb
  language plpgsql stable security definer set search_path = public as $fn$
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  return (select coalesce(jsonb_agg(product_json(p, true) || jsonb_build_object('waiting',
             (select count(*) from interest i where i.pid = p.id and i.notified_at is null))
             order by p.list_order, p.id), '[]'::jsonb)
            from products p);
end;
$fn$;

-- ---------------------------------------------------------------------
--  save_product(p) -- add a product (no id) or change one (its id).
--  Staff only. Every field is checked HERE as well as on the page: the
--  page's checks are for the owner's convenience, these are the rules.
--
--  ⚠️ IT DOES NOT CHANGE STOCK THAT EXISTS. An order may have taken some
--  while the editor was open; writing the editor's numbers back would
--  undo it. A NEW product takes the stock it is given, a colour or size
--  added to one takes what it is given (none, if nothing), and stock
--  already there is changed by set_stock() alone.
-- ---------------------------------------------------------------------
create or replace function save_product(p jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  pid    text := nullif(trim(coalesce(p->>'id', '')), '');
  cur    products;
  done   products;
  cols   jsonb;
  sizes  jsonb;
  v      jsonb;
  imgs   jsonb := coalesce(p->'img', '[]'::jsonb);
  v_specs  jsonb := coalesce(p->'specs', '[]'::jsonb);
  v_badges jsonb := coalesce(p->'badges', '[]'::jsonb);
  v_tags   jsonb := coalesce(p->'tags', '[]'::jsonb);
  v_skus   jsonb := '{}'::jsonb;
  st     text;
  sm     text;
  e      jsonb;
  k      text;
  n      int;
  pr     int;
  mr     int;
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'BAD_PRODUCT'; end if;
  if pid is not null then
    select * into cur from products where id = pid for update;
    if not found then raise exception 'NO_SUCH_PRODUCT'; end if;
  end if;

  -- What it is, and where it is filed.
  if length(trim(coalesce(p->>'name', ''))) not between 1 and 120 then raise exception 'BAD_NAME'; end if;
  if coalesce(p->>'slug', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'BAD_SLUG'; end if;
  if length(p->>'slug') > 56 then raise exception 'BAD_SLUG'; end if;
  if exists (select 1 from products where slug = p->>'slug' and id is distinct from pid) then
    raise exception 'SLUG_TAKEN';
  end if;
  if coalesce(p->>'cat', '') !~ '^[a-z0-9-]{1,40}$' then raise exception 'BAD_CATEGORY'; end if;
  if coalesce(p->>'sub', '') !~ '^([a-z0-9-]{1,40})?$' then raise exception 'BAD_CATEGORY'; end if;
  if length(coalesce(p->>'shortDesc', '')) > 300 then raise exception 'TOO_LONG'; end if;
  if length(coalesce(p->>'desc', '')) > 4000 then raise exception 'TOO_LONG'; end if;
  if coalesce(p->>'sizeChart', '') !~ '^([a-z0-9-]{1,40})?$' then raise exception 'BAD_SIZE_CHART'; end if;

  -- Money: whole rupees, the price at or under the MRP.
  pr := whole(p->'price');
  mr := whole(p->'mrp');
  if pr is null or pr < 1 or pr > 100000 then raise exception 'BAD_PRICE'; end if;
  if mr is null or mr < pr or mr > 100000 then raise exception 'BAD_MRP'; end if;

  -- Photographs: this shop's own files, or ones uploaded to its storage.
  if jsonb_typeof(imgs) is distinct from 'array' then raise exception 'BAD_PHOTOS'; end if;
  if jsonb_array_length(imgs) > 12 then raise exception 'BAD_PHOTOS'; end if;
  for e in select value from jsonb_array_elements(imgs) loop
    if jsonb_typeof(e) <> 'string' then raise exception 'BAD_PHOTOS'; end if;
    if position('..' in e #>> '{}') > 0 then raise exception 'BAD_PHOTOS'; end if;
    if (e #>> '{}') !~ ('^(img/products/[A-Za-z0-9_.-]+|https://[a-z0-9]+\.supabase\.co/storage/v1/'
                        || 'object/public/product-photos/[A-Za-z0-9_./-]+)\.(jpe?g|png|webp)$') then
      raise exception 'BAD_PHOTOS';
    end if;
  end loop;

  -- Variants: colours carry a label, a swatch and their photograph; only
  -- sizes move the price (domain.js variantPrice, data.pl).
  v := coalesce(p->'variants', '{}'::jsonb);
  if jsonb_typeof(v) <> 'object' then raise exception 'BAD_VARIANTS'; end if;
  cols  := coalesce(v->'colour', '[]'::jsonb);
  sizes := coalesce(v->'size', '[]'::jsonb);
  if jsonb_typeof(cols) <> 'array' or jsonb_typeof(sizes) <> 'array' then raise exception 'BAD_VARIANTS'; end if;
  if jsonb_array_length(cols) > 12 or jsonb_array_length(sizes) > 12 then raise exception 'BAD_VARIANTS'; end if;
  for e in select value from jsonb_array_elements(cols) loop
    if jsonb_typeof(e) <> 'object' then raise exception 'BAD_COLOUR'; end if;
    if coalesce(e->>'id', '') !~ '^[a-z0-9-]{1,30}$' then raise exception 'BAD_COLOUR'; end if;
    if length(trim(coalesce(e->>'label', ''))) not between 1 and 40 then raise exception 'BAD_COLOUR'; end if;
    if coalesce(e->>'swatch', '') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'BAD_COLOUR'; end if;
    if coalesce(e->'delta', '0'::jsonb) <> '0'::jsonb then raise exception 'BAD_COLOUR'; end if;
    if coalesce(jsonb_typeof(e->'img'), 'null') <> 'null' then
      n := whole(e->'img');
      if n is null then raise exception 'BAD_COLOUR'; end if;
      if n >= jsonb_array_length(imgs) then raise exception 'BAD_COLOUR'; end if;
    end if;
  end loop;
  if (select count(distinct x->>'id') from jsonb_array_elements(cols) x) <> jsonb_array_length(cols) then
    raise exception 'BAD_COLOUR';
  end if;
  for e in select value from jsonb_array_elements(sizes) loop
    if jsonb_typeof(e) <> 'object' then raise exception 'BAD_SIZE'; end if;
    if coalesce(e->>'id', '') !~ '^[a-z0-9-]{1,10}$' then raise exception 'BAD_SIZE'; end if;
    if length(trim(coalesce(e->>'label', ''))) not between 1 and 10 then raise exception 'BAD_SIZE'; end if;
    if jsonb_typeof(e->'delta') is distinct from 'number' then raise exception 'BAD_SIZE'; end if;
    if (e->'delta')::text !~ '^-?[0-9]{1,5}$' then raise exception 'BAD_SIZE'; end if;
    if pr + (e->>'delta')::int < 1 then raise exception 'BAD_SIZE'; end if;
  end loop;
  if (select count(distinct x->>'id') from jsonb_array_elements(sizes) x) <> jsonb_array_length(sizes) then
    raise exception 'BAD_SIZE';
  end if;
  -- Rebuilt from what was checked, so nothing else rides along.
  v := jsonb_build_object(
    'colour', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'id', x->>'id', 'label', trim(x->>'label'), 'swatch', upper(x->>'swatch'),
                 'delta', 0, 'img', whole(x->'img'))) order by i)
               from jsonb_array_elements(cols) with ordinality as t(x, i)), '[]'::jsonb),
    'size', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', x->>'id', 'label', trim(x->>'label'), 'delta', (x->>'delta')::int) order by i)
               from jsonb_array_elements(sizes) with ordinality as t(x, i)), '[]'::jsonb));
  if jsonb_array_length(v->'colour') = 0 then v := v - 'colour'; end if;
  if jsonb_array_length(v->'size') = 0 then v := v - 'size'; end if;

  -- The rest: specifications, search words, and what a person chose to
  -- badge -- never a badge the shop works out for itself.
  if jsonb_typeof(v_specs) is distinct from 'array' then raise exception 'BAD_SPECS'; end if;
  if jsonb_array_length(v_specs) > 20 then raise exception 'BAD_SPECS'; end if;
  for e in select value from jsonb_array_elements(v_specs) loop
    if jsonb_typeof(e) <> 'object' then raise exception 'BAD_SPECS'; end if;
    if length(trim(coalesce(e->>'k', ''))) not between 1 and 60 then raise exception 'BAD_SPECS'; end if;
    if length(trim(coalesce(e->>'v', ''))) not between 1 and 300 then raise exception 'BAD_SPECS'; end if;
  end loop;
  v_specs := coalesce((select jsonb_agg(jsonb_build_object('k', trim(x->>'k'), 'v', trim(x->>'v')) order by i)
                       from jsonb_array_elements(v_specs) with ordinality as t(x, i)), '[]'::jsonb);
  if jsonb_typeof(v_tags) is distinct from 'array' then raise exception 'BAD_TAGS'; end if;
  if jsonb_array_length(v_tags) > 20 then raise exception 'BAD_TAGS'; end if;
  if exists (select 1 from jsonb_array_elements(v_tags) x
              where jsonb_typeof(x) <> 'string' or length(x #>> '{}') not between 1 and 40) then
    raise exception 'BAD_TAGS';
  end if;
  if jsonb_typeof(v_badges) is distinct from 'array' then raise exception 'BAD_BADGES'; end if;
  if exists (select 1 from jsonb_array_elements(v_badges) x
              where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^[a-z0-9-]{1,20}$'
                 or (x #>> '{}') in ('new', 'sale', 'low-stock', 'sold-out')) then
    raise exception 'BAD_BADGES';
  end if;

  -- Where it stands: on sale ('active'), 'disabled', or a 'hidden' draft --
  -- as given, else as it was (a new one goes on sale). Deleting is
  -- set_status()'s alone. And how its stock is kept: always in stock unless
  -- told otherwise (9 November 2026, the owner's word).
  st := coalesce(nullif(p->>'status', ''),
                 case when (p->>'hidden')::boolean then 'hidden' end,
                 case when cur.id is null then 'active' when cur.hidden then 'hidden'
                      when cur.disabled then 'disabled' else 'active' end);
  if st not in ('active', 'disabled', 'hidden') then raise exception 'BAD_STATUS'; end if;
  sm := coalesce(nullif(p->>'stockMode', ''), cur.stock_mode, 'always');
  if sm not in ('always', 'counted', 'out') then raise exception 'BAD_STOCK_MODE'; end if;
  -- In the shop needs a photograph: a shop does not sell a blank.
  if st <> 'hidden' and jsonb_array_length(imgs) = 0 then raise exception 'NEEDS_A_PHOTO'; end if;

  -- Stock: what the database holds for every colour and size still sold,
  -- and what was given for one that is new.
  for k in select unnest(sku_keys(v)) loop
    if cur.id is not null and cur.skus ? k then
      n := (cur.skus->>k)::int;
    elsif coalesce(p->'skus', '{}'::jsonb) ? k then
      n := whole(p->'skus'->k);
      if n is null or n > 100000 then raise exception 'BAD_STOCK'; end if;
    else
      n := 0;
    end if;
    v_skus := v_skus || jsonb_build_object(k, n);
  end loop;

  if pid is null then
    pid := 'p-' || (p->>'slug');
    n := 1;
    while exists (select 1 from products where id = pid) loop
      n := n + 1;
      pid := 'p-' || (p->>'slug') || '-' || n;
    end loop;
    insert into products (id, slug, name, cat, sub, price, mrp, short_desc, descr, specs,
                          variants, img, skus, badges, tags, size_chart, hidden, disabled,
                          stock_mode, list_order)
    values (pid, p->>'slug', trim(p->>'name'), p->>'cat', nullif(p->>'sub', ''), pr, mr,
            trim(coalesce(p->>'shortDesc', '')), trim(coalesce(p->>'desc', '')), v_specs,
            v, imgs, v_skus, v_badges, v_tags, nullif(p->>'sizeChart', ''),
            st = 'hidden', st = 'disabled', sm,
            coalesce((select max(list_order) from products), 0) + 1)
    returning * into done;
  else
    update products set
      slug = p->>'slug', name = trim(p->>'name'), cat = p->>'cat', sub = nullif(p->>'sub', ''),
      price = pr, mrp = mr, short_desc = trim(coalesce(p->>'shortDesc', '')),
      descr = trim(coalesce(p->>'desc', '')), specs = v_specs, variants = v, img = imgs,
      skus = v_skus, badges = v_badges, tags = v_tags, size_chart = nullif(p->>'sizeChart', ''),
      hidden = (st = 'hidden'), disabled = (st = 'disabled'), stock_mode = sm,
      updated_at = now()
    where id = pid
    returning * into done;
  end if;
  -- Back on sale, or a size back in stock: whoever asked is told.
  perform wake_interest(done.id);
  return product_json(done, true);
end;
$fn$;

-- The price and the MRP alone: the store's quick change. Staff only.
create or replace function set_price(p_pid text, p_price int, p_mrp int) returns jsonb
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  cur  products;
  done products;
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  select * into cur from products where id = p_pid for update;
  if not found then raise exception 'NO_SUCH_PRODUCT'; end if;
  if p_price is null or p_price < 1 or p_price > 100000 then raise exception 'BAD_PRICE'; end if;
  if p_mrp is null or p_mrp < p_price or p_mrp > 100000 then raise exception 'BAD_MRP'; end if;
  -- No size may come to nothing: a size cheaper than the base price
  -- carries a negative delta.
  if exists (select 1 from jsonb_array_elements(coalesce(cur.variants->'size', '[]'::jsonb)) s
              where p_price + coalesce((s->>'delta')::int, 0) < 1) then
    raise exception 'BAD_PRICE';
  end if;
  update products set price = p_price, mrp = p_mrp, updated_at = now()
   where id = p_pid returning * into done;
  return product_json(done, true);
end;
$fn$;

-- ---------------------------------------------------------------------
--  set_stock(pid, changes) -- the store changes the stock of some colours
--  and sizes. Staff only. Each change is [what the page showed, what was
--  typed], and the DIFFERENCE is applied, so an order placed while the
--  page was open is not undone: the page said 10, five more came in and
--  the owner typed 15, an order took one meanwhile -- 14, not 15.
-- ---------------------------------------------------------------------
create or replace function set_stock(p_pid text, p_changes jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  cur   products;
  done  products;
  known text[];
  k     text;
  e     jsonb;
  was   int;
  typed int;
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  select * into cur from products where id = p_pid for update;
  if not found then raise exception 'NO_SUCH_PRODUCT'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' then raise exception 'BAD_STOCK'; end if;
  known := sku_keys(cur.variants);
  for k, e in select key, value from jsonb_each(p_changes) loop
    if not (k = any(known)) then raise exception 'BAD_STOCK'; end if;
    if jsonb_typeof(e) is distinct from 'array' then raise exception 'BAD_STOCK'; end if;
    if jsonb_array_length(e) <> 2 then raise exception 'BAD_STOCK'; end if;
    was   := whole(e->0);
    typed := whole(e->1);
    if was is null or typed is null or typed > 100000 then raise exception 'BAD_STOCK'; end if;
    cur.skus := jsonb_set(cur.skus, array[k],
      to_jsonb(greatest(0, coalesce((cur.skus->>k)::int, 0) + typed - was)));
  end loop;
  update products set skus = cur.skus, updated_at = now()
   where id = p_pid returning * into done;
  perform wake_interest(p_pid);
  return product_json(done, true);
end;
$fn$;

-- set_hidden() became set_status() on 9 November 2026; the page no longer
-- calls it, and a grant nothing uses is a door left open.
drop function if exists set_hidden(text, boolean);

-- ---------------------------------------------------------------------
--  set_status(pid, status) -- on sale ('active'), 'disabled', a 'hidden'
--  draft, or 'deleted'. Staff only. In the shop -- on sale or disabled --
--  needs a photograph. Deleting keeps the row (past orders and bags find
--  it by id); any other status brings a deleted product back.
-- ---------------------------------------------------------------------
create or replace function set_status(p_pid text, p_status text) returns jsonb
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  cur  products;
  done products;
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  if p_status is null or p_status not in ('active', 'disabled', 'hidden', 'deleted') then
    raise exception 'BAD_STATUS';
  end if;
  select * into cur from products where id = p_pid for update;
  if not found then raise exception 'NO_SUCH_PRODUCT'; end if;
  if p_status in ('active', 'disabled') and jsonb_array_length(cur.img) = 0 then
    raise exception 'NEEDS_A_PHOTO';
  end if;
  if p_status = 'deleted' then
    update products set deleted_at = coalesce(deleted_at, now()), updated_at = now()
     where id = p_pid returning * into done;
  else
    update products set deleted_at = null, hidden = (p_status = 'hidden'),
                        disabled = (p_status = 'disabled'), updated_at = now()
     where id = p_pid returning * into done;
  end if;
  perform wake_interest(p_pid);
  return product_json(done, true);
end;
$fn$;

-- How a product's stock is kept: 'always' in stock, 'out' of stock, or
-- 'counted' by colour and size. Staff only. The counts stay as they were
-- whichever is chosen, so going back to counting finds them.
create or replace function set_stock_mode(p_pid text, p_mode text) returns jsonb
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  done products;
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  if p_mode is null or p_mode not in ('always', 'counted', 'out') then
    raise exception 'BAD_STOCK_MODE';
  end if;
  update products set stock_mode = p_mode, updated_at = now()
   where id = p_pid returning * into done;
  if not found then raise exception 'NO_SUCH_PRODUCT'; end if;
  perform wake_interest(p_pid);
  return product_json(done, true);
end;
$fn$;

-- ---------------------------------------------------------------------
--  take_lines(lines) -- an order's lines, checked against the catalogue
--  and their stock taken off. Called by place_order() alone (granted to
--  nobody), in its transaction: if anything after it fails, the stock
--  comes back with the rest. Returns what the lines add up to.
--
--  Named refusals, each with what the page needs to say which item:
--  GONE_FROM_CATALOGUE <pid>, PRICE_CHANGED <pid>, OUT_OF_STOCK <pid>
--  <colour/size> <left>.
-- ---------------------------------------------------------------------
create or replace function take_lines(p_lines jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  item  jsonb;
  prod  products;
  q     int;
  up    int;
  um    int;
  col   text;
  siz   text;
  delta int;
  k     text;
  have  int;
  items int := 0;
  mrp   int := 0;
begin
  -- Two checks, not one with an OR: SQL does not promise to test the left
  -- side first, and jsonb_array_length() of a non-array is an error of its
  -- own rather than this refusal.
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'BAD_LINES'; end if;
  if jsonb_array_length(p_lines) not between 1 and 20 then raise exception 'BAD_LINES'; end if;

  for item in select value from jsonb_array_elements(p_lines) loop
    -- ⚠️ coalesce() before every test. A missing number is NULL, a test on
    -- NULL is neither true nor false, and an IF reads "unknown" as false --
    -- so without it a line with no price would walk past every check here.
    q  := coalesce(whole(item->'qty'), 0);
    up := coalesce(whole(item->'unitPrice'), 0);
    um := coalesce(whole(item->'unitMrp'), 0);
    if q not between 1 and 10 or up <= 0 or um < up then raise exception 'BAD_LINE'; end if;

    select * into prod from products where id = item->>'pid' for update;
    if not found then raise exception 'GONE_FROM_CATALOGUE %', item->>'pid'; end if;
    if prod.hidden or prod.deleted_at is not null then
      raise exception 'GONE_FROM_CATALOGUE %', prod.id;
    end if;

    -- A colour and a size it sells -- each exactly when it has them.
    col := nullif(item->'variant'->>'colour', '');
    siz := nullif(item->'variant'->>'size', '');
    if (jsonb_array_length(coalesce(prod.variants->'colour', '[]'::jsonb)) > 0) <> (col is not null)
       or (jsonb_array_length(coalesce(prod.variants->'size', '[]'::jsonb)) > 0) <> (siz is not null) then
      raise exception 'BAD_LINE';
    end if;
    if col is not null and not exists (
         select 1 from jsonb_array_elements(prod.variants->'colour') c where c->>'id' = col) then
      raise exception 'BAD_LINE';
    end if;
    delta := 0;
    if siz is not null then
      select coalesce((s->>'delta')::int, 0) into delta
        from jsonb_array_elements(prod.variants->'size') s where s->>'id' = siz;
      if not found then raise exception 'BAD_LINE'; end if;
    end if;

    -- On sale at all (9 November 2026): a disabled product, or one marked
    -- out of stock, is in nobody's order -- said as out of stock, so the
    -- bag tells the customer what the shop shows.
    if prod.kind <> 'voucher' and (prod.disabled or prod.stock_mode = 'out') then
      raise exception 'OUT_OF_STOCK % % 0', prod.id, sku_key(item->'variant');
    end if;

    -- TODAY'S PRICE for that size, and its MRP.
    if up <> prod.price + delta or um <> prod.mrp + delta then
      raise exception 'PRICE_CHANGED %', prod.id;
    end if;

    -- And the stock of that colour in that size -- when it is counted. A
    -- product always in stock has nothing to take off.
    if prod.kind <> 'voucher' and prod.stock_mode = 'counted' then
      k := sku_key(item->'variant');
      have := coalesce((prod.skus->>k)::int, 0);
      if have < q then raise exception 'OUT_OF_STOCK % % %', prod.id, k, have; end if;
      update products set skus = jsonb_set(skus, array[k], to_jsonb(have - q)), updated_at = now()
       where id = prod.id;
    end if;

    items := items + up * q;
    mrp   := mrp   + um * q;
  end loop;
  return jsonb_build_object('items', items, 'mrp', mrp);
end;
$fn$;

-- An item's stock back on the shelf -- once, and only if it was taken
-- (an order placed before 8 November 2026 took none). Called when an
-- item is cancelled; granted to nobody. A returned item is NOT put back:
-- somebody looks at it first, then adds it in the store's stock.
create or replace function restock_line(p_line bigint) returns void
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  l order_lines;
  k text;
begin
  select * into l from order_lines where id = p_line and stock_taken for update;
  if not found then return; end if;
  k := sku_key(l.variant);
  -- Only to a colour and size still sold: one since removed has no shelf.
  update products set skus = jsonb_set(skus, array[k], to_jsonb((skus->>k)::int + l.qty)),
                      updated_at = now()
   where id = l.pid and skus ? k;
  update order_lines set stock_taken = false where id = p_line;
  -- A size that was sold out may be back: whoever asked is told.
  perform wake_interest(l.pid);
end;
$fn$;

-- ---------------------------------------------------------------------
--  PHOTOGRAPHS -- the store uploads a product's photographs to this
--  project's storage, bucket product-photos. Anybody may look at them (a
--  shop's photographs are for everybody, and the bucket is public); only
--  the store may put one there. The page makes each one a 4:5 JPEG of at
--  most 1024 by 1280 before it is sent, well under the 3 MB allowed.
-- ---------------------------------------------------------------------
--
--  ⚠️ IN A BLOCK OF ITS OWN. These touch Supabase's own storage tables,
--  which it owns and may one day tighten; refused, they must not take the
--  rest of this file down with them (the editor runs it all or nothing).
--  So a refusal here is a NOTICE, the products and every check still go
--  in, and selftest.sql fails by name if the bucket or its rule is missing.
do $photos$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('product-photos', 'product-photos', true, 3145728,
          array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists product_photos_add on storage.objects;
  create policy product_photos_add on storage.objects for insert to authenticated
    with check (bucket_id = 'product-photos' and public.is_staff());
  drop policy if exists product_photos_read on storage.objects;
  create policy product_photos_read on storage.objects for select to authenticated
    using (bucket_id = 'product-photos' and public.is_staff());
exception when others then
  raise notice 'PHOTO STORAGE NOT SET UP (%): the products, prices and stock are in; uploading a photograph from the store needs this part. Tell Claude what it says.', sqlerrm;
end $photos$;

-- =====================================================================
--  TELLING CUSTOMERS (9 November 2026, the owner): "if that product is
--  active again ... the other user gets a notification", and "whenever
--  any status changed, give that notification to the person who ordered
--  the product".
--
--  BY EMAIL -- the one way a message can go out by itself, for nothing:
--  WhatsApp and SMS need paid business accounts. The shop already sends
--  its sign-in codes through Brevo; these go through Brevo's API, with a
--  key that db/email.sql keeps in Supabase's Vault (typed into the SQL
--  editor, never into a file -- this repository is public).
--
--  NOTHING HERE WAITS ON THE EMAIL: a status change or a product coming
--  back only marks what is owed (touch_order, wake_interest), and
--  send_notices() -- every minute, by pg_cron -- sends it. With no key
--  yet, everything simply waits, and goes when there is one.
-- =====================================================================

-- ---------------------------------------------------------------------
--  INTEREST -- a signed-in customer asks to be told when a product, or
--  one colour in one size, can be bought again. Signed in, so the
--  address was proved by a code: nobody can make the shop email a
--  stranger. Each is told once; asking again starts it over.
-- ---------------------------------------------------------------------
create table if not exists interest (
  id          bigserial primary key,
  pid         text not null,
  sku         text,                 -- 'navy/m', or null: any colour, any size
  user_id     uuid not null references auth.users on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now(),
  ready_at    timestamptz,          -- it can be bought: an email is owed
  notified_at timestamptz           -- the email went
);
create unique index if not exists interest_once on interest (pid, (coalesce(sku, '')), user_id);
alter table interest enable row level security;
-- A customer sees what they asked for; the store sees everyone's.
drop policy if exists interest_read on interest;
create policy interest_read on interest for select using (user_id = auth.uid() or is_staff());

-- Can this product -- or this colour in this size -- be bought now?
create or replace function can_buy(p_pid text, p_sku text) returns boolean
  language sql stable set search_path = public as $fn$
  select coalesce((
    select not p.hidden and not p.disabled and p.deleted_at is null and p.stock_mode <> 'out'
       and (p.stock_mode = 'always'
            or (p_sku is null and exists (select 1 from jsonb_each_text(p.skus) e where e.value::int > 0))
            or (p_sku is not null and coalesce((p.skus->>p_sku)::int, 0) > 0))
      from products p where p.id = p_pid), false);
$fn$;

-- Mark every customer waiting for this product who can now buy what they
-- asked for. Called after every change to a product; granted to nobody.
create or replace function wake_interest(p_pid text) returns int
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  n int := 0;
begin
  update interest set ready_at = now()
   where pid = p_pid and notified_at is null and ready_at is null and can_buy(pid, sku);
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- "Tell me when it's back". Returns the address the email will go to.
create or replace function register_interest(p_pid text, p_sku text default null) returns text
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  prod products;
  em   text;
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  select email into em from auth.users
   where id = auth.uid() and not coalesce(is_anonymous, false) and email is not null;
  if em is null then raise exception 'SIGN_IN_FIRST'; end if;
  select * into prod from products where id = p_pid;
  if not found then raise exception 'GONE_FROM_CATALOGUE %', p_pid; end if;
  if prod.hidden or prod.deleted_at is not null then raise exception 'GONE_FROM_CATALOGUE %', p_pid; end if;
  if p_sku is not null and not (p_sku = any(sku_keys(prod.variants))) then raise exception 'BAD_SKU'; end if;
  -- No captcha here either: thirty an hour is a keen customer, not a script.
  if (select count(*) from interest
       where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'TOO_MANY';
  end if;
  insert into interest (pid, sku, user_id, email) values (p_pid, p_sku, auth.uid(), em)
  on conflict (pid, (coalesce(sku, '')), user_id)
  do update set email = excluded.email, created_at = now(), ready_at = null, notified_at = null;
  perform wake_interest(p_pid);
  return em;
end;
$fn$;

-- "Don't tell me after all."
create or replace function drop_interest(p_pid text, p_sku text default null) returns void
  language plpgsql volatile security definer set search_path = public as $fn$
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  delete from interest
   where user_id = auth.uid() and pid = p_pid and coalesce(sku, '') = coalesce(p_sku, '');
end;
$fn$;

-- ---------------------------------------------------------------------
--  AN ORDER'S NEWS. Every change marks the order (touch_order) for two
--  minutes later, and send_notices() then compares what the order looks
--  like now with what the customer was last told (order_state): if they
--  differ, one email says where it is -- so a quick run of taps, or a
--  slip put right at once, is one email or none, never a string of them.
--  The first is "we have your order".
-- ---------------------------------------------------------------------
alter table orders add column if not exists notify_after   timestamptz;
alter table orders add column if not exists notified_state text;

create or replace function order_state(p_oid uuid) returns text
  language sql stable set search_path = public as $fn$
  select o.status || '|' || coalesce((select string_agg(l.id::text || ':' || l.status, ',' order by l.id)
                                        from order_lines l where l.order_id = o.id), '')
    from orders o where o.id = p_oid;
$fn$;

create or replace function touch_order(p_oid uuid) returns void
  language sql volatile set search_path = public as $fn$
  update orders set notify_after = now() + interval '2 minutes' where id = p_oid;
$fn$;

-- Every email that went, for the store to see (no policy: through
-- notices_log() only).
create table if not exists notices (
  id         bigserial primary key,
  kind       text not null check (kind in ('order', 'interest', 'test')),
  order_id   uuid,
  pid        text,
  email      text not null,
  subject    text not null,
  request_id bigint,
  created_at timestamptz not null default now()
);
alter table notices enable row level security;

-- Words a customer typed go into an email as text, never as markup.
create or replace function html_escape(t text) returns text
  language sql immutable set search_path = public as $fn$
  select replace(replace(replace(replace(replace(coalesce(t, ''),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$fn$;

-- "Navy · M" for a stock key, in the product's own names.
create or replace function sku_label(v jsonb, k text) returns text
  language sql immutable set search_path = public as $fn$
  select nullif(concat_ws(' · ',
    (select c->>'label' from jsonb_array_elements(coalesce(v->'colour', '[]'::jsonb)) c
      where c->>'id' = case when jsonb_array_length(coalesce(v->'colour', '[]'::jsonb)) > 0
                            then split_part(k, '/', 1) end),
    (select s->>'label' from jsonb_array_elements(coalesce(v->'size', '[]'::jsonb)) s
      where s->>'id' = case when jsonb_array_length(coalesce(v->'colour', '[]'::jsonb)) > 0
                            then split_part(k, '/', 2) else k end)), '');
$fn$;

-- The email about an order, as it is now: { subject, html }. The words
-- are the customer's (domain.js TRACK_LABEL says the same on the page).
create or replace function order_mail(p_oid uuid, p_shop text) returns jsonb
  language plpgsql stable security definer set search_path = public as $fn$
declare
  o     orders;
  site  text := 'https://jinaynandu.github.io/clothes-app/';
  word  text;
  head  text;
  items text;
  who   text;
  ship  text := '';
begin
  select * into o from orders where id = p_oid;
  if not found then return null; end if;
  who := split_part(coalesce(nullif(trim(o.cust_name), ''), 'there'), ' ', 1);
  word := case o.status
    when 'sent'      then 'We have your order'
    when 'confirmed' then 'Your order is confirmed'
    when 'packed'    then 'Your order is packed'
    when 'shipped'   then 'Your order is on its way'
    when 'delivered' then 'Your order has been delivered'
    when 'returned'  then 'Your return has reached us'
    else 'Your order has been cancelled' end;
  -- The order's own step moved, or only an item within it.
  head := case when o.notified_state is null or split_part(o.notified_state, '|', 1) <> o.status
               then word else 'An update on your order' end;
  if o.status = 'shipped' and o.shipment is not null and coalesce(o.shipment->>'courier', '') <> '' then
    ship := '<p>Courier: ' || html_escape(o.shipment->>'courier')
         || case when coalesce(o.shipment->>'ref', '') <> ''
                 then ', tracking number ' || html_escape(o.shipment->>'ref') else '' end || '</p>';
  end if;
  select string_agg('<tr><td style="padding:4px 16px 4px 0">' || html_escape(l.name)
           || case when coalesce(l.variant_label, '') <> ''
                   then ' <span style="color:#6B5C4E">(' || html_escape(l.variant_label) || ')</span>' else '' end
           || ' &times; ' || l.qty || '</td><td style="padding:4px 0;color:#5A4C40">'
           || case l.status when 'sent' then 'Ordered' when 'confirmed' then 'Confirmed'
                when 'packed' then 'Packed' when 'shipped' then 'On its way'
                when 'delivered' then 'Delivered' when 'returned' then 'Returned'
                else 'Cancelled' end || '</td></tr>', '' order by l.id)
    into items from order_lines l where l.order_id = o.id;
  return jsonb_build_object(
    'subject', head || ' (' || o.code || ')',
    'html', '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#241C16;max-width:560px">'
      || '<p>Hello ' || html_escape(who) || ',</p>'
      || '<p><b>' || html_escape(word) || '</b> &mdash; order ' || html_escape(o.code) || '.</p>'
      || ship
      || '<table style="border-collapse:collapse;margin:8px 0 16px">' || coalesce(items, '') || '</table>'
      || '<p><a href="' || site || '#/order/' || html_escape(o.code) || '" style="color:#7A5D1D">See your order</a></p>'
      || '<p style="color:#6B5C4E;font-size:13px">' || html_escape(p_shop) || '</p></div>');
end;
$fn$;

-- The email to a customer who asked to be told: { subject, html }.
create or replace function interest_mail(p_id bigint, p_shop text) returns jsonb
  language plpgsql stable security definer set search_path = public as $fn$
declare
  i    interest;
  prod products;
  what text;
  site text := 'https://jinaynandu.github.io/clothes-app/';
begin
  select * into i from interest where id = p_id;
  if not found then return null; end if;
  select * into prod from products where id = i.pid;
  if not found then return null; end if;
  what := prod.name || coalesce(' in ' || sku_label(prod.variants, i.sku), '');
  return jsonb_build_object(
    'subject', what || ' is back',
    'html', '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#241C16;max-width:560px">'
      || '<p>Hello,</p>'
      || '<p>You asked us to tell you: <b>' || html_escape(what) || '</b> can be ordered again.</p>'
      || '<p><a href="' || site || '#/p/' || html_escape(prod.slug) || '" style="color:#7A5D1D">See it in the shop</a></p>'
      || '<p style="color:#6B5C4E;font-size:13px">We will not email you about it again. '
      || html_escape(p_shop) || '</p></div>');
end;
$fn$;

-- ---------------------------------------------------------------------
--  send_notices() -- every email that is owed, through Brevo. pg_cron
--  runs it every minute; the store page asks for it too, in case the
--  minute job could not be set up. Rows are taken with SKIP LOCKED, so
--  two runs at once never send one email twice. With no key in the Vault
--  -- db/email.sql not run yet -- it sends nothing and leaves everything
--  owed, to go when there is one.
-- ---------------------------------------------------------------------
create or replace function send_notices() returns int
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  api_key text;
  sender  text;
  shop    text;
  o       record;
  i       record;
  st      text;
  mail    jsonb;
  to_addr text;
  rid     bigint;
  n       int := 0;
begin
  begin
    select decrypted_secret into api_key from vault.decrypted_secrets where name = 'vastra_brevo_key';
    select decrypted_secret into sender  from vault.decrypted_secrets where name = 'vastra_mail_from';
    select decrypted_secret into shop    from vault.decrypted_secrets where name = 'vastra_mail_name';
  exception when others then
    return 0;
  end;
  if api_key is null or sender is null then return 0; end if;
  shop := coalesce(nullif(trim(shop), ''), 'Vastra Apparel');

  for o in select id, user_id, cust_email, cust_name, notified_state from orders
            where notify_after is not null and notify_after <= now()
            order by notify_after limit 50 for update skip locked loop
    st := order_state(o.id);
    if st is distinct from o.notified_state then
      to_addr := coalesce(nullif(trim(o.cust_email), ''),
                          (select email from auth.users where id = o.user_id));
      if to_addr is not null then
        mail := order_mail(o.id, shop);
        rid := net.http_post(
          url := 'https://api.brevo.com/v3/smtp/email',
          body := jsonb_build_object(
            'sender', jsonb_build_object('name', shop, 'email', sender),
            'to', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                    'email', to_addr, 'name', nullif(trim(o.cust_name), '')))),
            'subject', mail->>'subject', 'htmlContent', mail->>'html'),
          headers := jsonb_build_object('api-key', api_key, 'Content-Type', 'application/json',
                                        'Accept', 'application/json'));
        insert into notices (kind, order_id, email, subject, request_id)
        values ('order', o.id, to_addr, mail->>'subject', rid);
        n := n + 1;
      end if;
    end if;
    update orders set notify_after = null, notified_state = st where id = o.id;
  end loop;

  for i in select id, pid, sku, email from interest
            where ready_at is not null and notified_at is null
            order by ready_at limit 50 for update skip locked loop
    if can_buy(i.pid, i.sku) then
      mail := interest_mail(i.id, shop);
      rid := net.http_post(
        url := 'https://api.brevo.com/v3/smtp/email',
        body := jsonb_build_object(
          'sender', jsonb_build_object('name', shop, 'email', sender),
          'to', jsonb_build_array(jsonb_build_object('email', i.email)),
          'subject', mail->>'subject', 'htmlContent', mail->>'html'),
        headers := jsonb_build_object('api-key', api_key, 'Content-Type', 'application/json',
                                      'Accept', 'application/json'));
      insert into notices (kind, pid, email, subject, request_id)
      values ('interest', i.pid, i.email, mail->>'subject', rid);
      update interest set notified_at = now() where id = i.id;
      n := n + 1;
    else
      -- Gone again before it could be said: wait for the next time.
      update interest set ready_at = null where id = i.id;
    end if;
  end loop;
  return n;
end;
$fn$;

-- The store's "send what is waiting now". Staff only.
create or replace function send_notices_now() returns int
  language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  return send_notices();
end;
$fn$;

-- Whether emails can go, and what is waiting. Staff only.
create or replace function mail_status() returns jsonb
  language plpgsql stable security definer set search_path = public as $fn$
declare
  has_key  boolean := false;
  has_cron boolean := false;
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  begin
    select exists (select 1 from vault.decrypted_secrets where name = 'vastra_brevo_key') into has_key;
  exception when others then has_key := false;
  end;
  begin
    execute 'select exists (select 1 from cron.job where jobname = ''vastra-notices'')' into has_cron;
  exception when others then has_cron := false;
  end;
  return jsonb_build_object(
    'key', has_key,
    'net', exists (select 1 from pg_extension where extname = 'pg_net'),
    'cron', has_cron,
    'ordersWaiting', (select count(*) from orders where notify_after is not null),
    'interestWaiting', (select count(*) from interest where notified_at is null),
    'interestReady', (select count(*) from interest where ready_at is not null and notified_at is null));
end;
$fn$;

-- The last forty emails, and what Brevo answered (pg_net keeps answers a
-- few hours; older ones show without). Staff only.
create or replace function notices_log() returns jsonb
  language plpgsql stable security definer set search_path = public as $fn$
declare
  res jsonb;
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  begin
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', n.kind, 'email', n.email, 'subject', n.subject, 'at', n.created_at,
               'code', r.status_code,
               'error', coalesce(r.error_msg, case when r.status_code >= 300 then left(r.content, 200) end))
             order by n.created_at desc), '[]'::jsonb)
        from (select * from public.notices order by created_at desc limit 40) n
        left join net._http_response r on r.id = n.request_id
    $q$ into res;
  exception when others then
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', n.kind, 'email', n.email, 'subject', n.subject, 'at', n.created_at)
           order by n.created_at desc), '[]'::jsonb)
      into res from (select * from notices order by created_at desc limit 40) n;
  end;
  return res;
end;
$fn$;

-- ---------------------------------------------------------------------
--  EMAILS GO OUT BY THEMSELVES: pg_net makes the call to Brevo, and
--  pg_cron runs send_notices() every minute. Each in a block that only
--  warns if the project refuses it -- the rest of this file must not go
--  down with it -- and selftest.sql's last line says what is ready.
-- ---------------------------------------------------------------------
do $mail$
begin
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'EMAILS: pg_net could not be switched on (%). Database > Extensions > pg_net > enable, then run this file again.', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron;
    perform cron.schedule('vastra-notices', '* * * * *', 'select public.send_notices()');
  exception when others then
    raise notice 'EMAILS: the every-minute sender could not be set up (%). Integrations > Cron > enable, then run this file again. Until then the store page sends them while it is open.', sqlerrm;
  end;
end $mail$;

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
  tl        jsonb;
  items     int;
  mrp       int;
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

  -- The lines, against TODAY'S catalogue (8 November 2026): each its
  -- product's price for that size and a colour and size it sells, in
  -- stock -- and the stock taken off, in this transaction, so a refusal
  -- below puts it back. take_lines() above says how, and names each
  -- refusal: BAD_LINES, BAD_LINE, GONE_FROM_CATALOGUE, PRICE_CHANGED,
  -- OUT_OF_STOCK.
  tl    := take_lines(p->'lines');
  items := (tl->>'items')::int;
  mrp   := (tl->>'mrp')::int;

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
    items_total, mrp_total, saved, coupon, discount, discount_placed, shipping, bulky, grand,
    pay_method, paid, arrives_from, arrives_to, arrives_rule, history)
  values (
    auth.uid(), 'sent', c->>'name', c->>'mobile', nullif(c->>'email', ''),
    c->>'addr', c->>'city', c->>'state', c->>'pin',
    items, mrp, greatest(0, mrp - items), nullif(p->>'coupon', ''),
    disc, disc, ship, bulk, items - disc + ship + bulk,
    p->>'payMethod', false, a_from, a_to,
    jsonb_build_object('minDays', (p->'arrives'->>'minDays')::int,
                       'maxDays', (p->'arrives'->>'maxDays')::int,
                       'countedFrom', p->'arrives'->>'countedFrom'),
    jsonb_build_array(jsonb_build_object('at', stamp, 'to', 'sent', 'note', 'placed online')))
  returning id, code into new_id, new_code;

  -- The name and the link are the catalogue's, not the page's: the order
  -- must say what was actually sold. Every line was checked, and its
  -- stock taken unless it is a voucher.
  insert into order_lines (order_id, pid, name, slug, variant, variant_label,
                           qty, unit_price, unit_mrp, line_total, checked, stock_taken)
  select new_id, l->>'pid', pr.name, pr.slug, coalesce(l->'variant', '{}'::jsonb),
         l->>'variantLabel', (l->>'qty')::int, (l->>'unitPrice')::int,
         (l->>'unitMrp')::int, (l->>'unitPrice')::int * (l->>'qty')::int,
         true, pr.kind <> 'voucher' and pr.stock_mode = 'counted'
    from jsonb_array_elements(p->'lines') as t(l)
    join products pr on pr.id = l->>'pid';

  -- The customer hears that the shop has it (9 November 2026): a minute or
  -- two from now, by send_notices().
  perform touch_order(new_id);

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
  -- tools/db.pl fails if the two lists drift. sent -> cancelled since
  -- 7 November 2026: an online order the shop declines is cancelled, and
  -- the customer reads it so.
  if (cur, p_to) not in (
    ('sent', 'confirmed'), ('sent', 'cancelled'), ('sent', 'abandoned'),
    ('confirmed', 'packed'), ('confirmed', 'cancelled'),
    ('packed', 'shipped'), ('packed', 'cancelled'),
    ('shipped', 'delivered'), ('shipped', 'returned'),
    ('delivered', 'returned')
  ) then
    raise exception 'BAD_TRANSITION % -> %', cur, p_to;
  end if;

  -- Cancelling the whole order cannot take back an item already shipped
  -- on its own; that item is the courier's now. Cancel the others one by
  -- one instead.
  if p_to in ('cancelled', 'abandoned') and exists (
       select 1 from order_lines where order_id = p_oid
          and status in ('shipped', 'delivered', 'returned')) then
    raise exception 'SOME_ITEMS_SHIPPED';
  end if;

  -- Their stock back on the shelf, for every item this takes off its road
  -- (8 November 2026). None had left the building.
  if p_to in ('cancelled', 'abandoned') then
    perform restock_line(l.id) from order_lines l
     where l.order_id = p_oid and l.stock_taken and l.status in ('sent', 'confirmed', 'packed');
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
      else shipment end,
    updated_at   = now()
  where id = p_oid;

  -- Every item still on its way moves with the order: the ones AT the
  -- order's old status (an item already ahead stays ahead). Cancelling
  -- takes every item not yet shipped; a return, every item that was.
  update order_lines set
    status   = case when p_to = 'abandoned' then 'cancelled' else p_to end,
    history  = history || jsonb_build_array(jsonb_build_object('at', stamp,
                 'to', case when p_to = 'abandoned' then 'cancelled' else p_to end)),
    shipment = case
      when p_to = 'shipped'
       and (coalesce(trim(p_courier), '') <> '' or coalesce(trim(p_ref), '') <> '')
      then jsonb_build_object('courier', left(coalesce(trim(p_courier), ''), 60),
                              'ref',     left(coalesce(trim(p_ref), ''), 60))
      else shipment end
  where order_id = p_oid and status <> 'cancelled'
    and (status = cur
      or (p_to in ('cancelled', 'abandoned') and status in ('sent', 'confirmed', 'packed'))
      or (p_to = 'returned' and status in ('shipped', 'delivered')));

  -- The customer hears of it (9 November 2026), once things settle.
  perform touch_order(p_oid);
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
    paid        = p_paid,
    paid_at     = case when p_paid then now() else null end,
    paid_via    = case when p_paid then left(coalesce(p_via, 'checked by hand'), 60) else null end,
    -- The amount seen, kept: an item cancelled after this is money owed back.
    paid_amount = case when p_paid then grand else null end,
    updated_at  = now()
  where id = p_oid;
  if not found then raise exception 'NO_SUCH_ORDER'; end if;
end;
$fn$;

-- ---------------------------------------------------------------------
--  roll_up_order -- the order follows its items. Called by advance_line
--  and step_back_line after every item move; granted to nobody, only
--  called from inside.
--
--  STATUS: where the slowest item still on its way is; every item
--  cancelled, the order is cancelled. A rise of more than one step writes
--  each step passed into the history, so the customer's timeline never
--  shows "Packed: not yet" under "Shipped". An item stepped BACK below the
--  order (step_back_line) takes the order back with it, in one entry
--  marked as a step back.
--
--  MONEY, when an item is cancelled: the items total is what is left, and
--  the coupon shrinks in PROPORTION -- worked out from what it was when
--  the order was placed, so two cancellations do not round twice -- and
--  the total is re-added. Shipping and bulky handling stay. Nothing is
--  recalculated once every item is gone: the order is simply cancelled.
-- ---------------------------------------------------------------------
create or replace function roll_up_order(p_oid uuid, p_stamp text) returns void
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  road    text[] := array['sent', 'confirmed', 'packed', 'shipped', 'delivered', 'returned'];
  was     text;
  now_st  text;
  hist    jsonb := '[]'::jsonb;
  items   int;
  mrp     int;
  all_it  int;
  placed  int;
  disc    int;
  i       int;
begin
  select status, coalesce(discount_placed, discount) into was, placed
    from orders where id = p_oid for update;

  select status into now_st from order_lines
   where order_id = p_oid and status <> 'cancelled'
   order by array_position(road, status) limit 1;
  if now_st is null then now_st := 'cancelled'; end if;

  select coalesce(sum(line_total) filter (where status <> 'cancelled'), 0),
         coalesce(sum(unit_mrp * qty) filter (where status <> 'cancelled'), 0),
         coalesce(sum(line_total), 0)
    into items, mrp, all_it
    from order_lines where order_id = p_oid;

  if items > 0 and all_it > 0 then
    disc := round(placed::numeric * items / all_it);
    update orders set
      items_total = items, mrp_total = mrp, saved = greatest(0, mrp - items),
      discount = disc, grand = items - disc + shipping + bulky
     where id = p_oid;
  end if;

  if now_st is distinct from was then
    if now_st in ('cancelled', 'returned') or not (was = any(road)) then
      hist := jsonb_build_array(jsonb_build_object('at', p_stamp, 'to', now_st));
    elsif array_position(road, now_st) < array_position(road, was) then
      -- An item was stepped BACK and is now the slowest (8 November 2026):
      -- the order goes back with it, in one entry marked as a step back.
      hist := jsonb_build_array(jsonb_build_object('at', p_stamp, 'to', now_st, 'back', true));
    else
      for i in array_position(road, was) + 1 .. array_position(road, now_st) loop
        hist := hist || jsonb_build_array(jsonb_build_object('at', p_stamp, 'to', road[i]));
      end loop;
    end if;
    update orders set
      status       = now_st,
      history      = history || hist,
      -- Back from Delivered, the parcel has not landed: no delivery stamp,
      -- so no return window running. Back before Shipped, no courier.
      delivered_at = case when now_st = 'delivered' then p_stamp::timestamptz
                          when was = 'delivered' and now_st = any(road)
                           and array_position(road, now_st) < array_position(road, was) then null
                          else delivered_at end,
      shipment     = case when was = any(road) and now_st = any(road)
                           and array_position(road, now_st) < array_position(road, was)
                           and array_position(road, now_st) < array_position(road, 'shipped')
                          then null else shipment end
     where id = p_oid;
  end if;

  update orders set updated_at = now() where id = p_oid;
  -- One item moved, or back: the customer hears of it, once things settle.
  perform touch_order(p_oid);
end;
$fn$;

-- ---------------------------------------------------------------------
--  advance_line -- the store moves ONE item. Staff only.
-- ---------------------------------------------------------------------
create or replace function advance_line(p_line bigint, p_to text,
                                        p_courier text default null,
                                        p_ref text default null)
  returns void language plpgsql volatile security definer set search_path = public as $fn$
declare
  ord_id uuid;
  lcur  text;
  stamp text := iso_now();
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  select order_id, status into ord_id, lcur from order_lines where id = p_line for update;
  if ord_id is null then raise exception 'NO_SUCH_LINE'; end if;
  if p_to is null then raise exception 'BAD_TRANSITION'; end if;

  -- ⚠️ AN ITEM'S ROAD: the same pairs as LINE_NEXT in app/domain.js --
  -- the order's road less the draft and `abandoned`. tools/db.pl
  -- compares the two.
  if (lcur, p_to) not in (
    ('sent', 'confirmed'), ('sent', 'cancelled'),
    ('confirmed', 'packed'), ('confirmed', 'cancelled'),
    ('packed', 'shipped'), ('packed', 'cancelled'),
    ('shipped', 'delivered'), ('shipped', 'returned'),
    ('delivered', 'returned')
  ) then
    raise exception 'BAD_TRANSITION % -> %', lcur, p_to;
  end if;

  -- A cancelled item's stock goes back on the shelf (8 November 2026).
  if p_to = 'cancelled' then perform restock_line(p_line); end if;

  update order_lines set
    status   = p_to,
    history  = history || jsonb_build_array(jsonb_build_object('at', stamp, 'to', p_to)),
    shipment = case
      when p_to = 'shipped'
       and (coalesce(trim(p_courier), '') <> '' or coalesce(trim(p_ref), '') <> '')
      then jsonb_build_object('courier', left(coalesce(trim(p_courier), ''), 60),
                              'ref',     left(coalesce(trim(p_ref), ''), 60))
      else shipment end
  where id = p_line;

  perform roll_up_order(ord_id, stamp);
end;
$fn$;

-- ---------------------------------------------------------------------
--  mark_refund -- a person at the shop has sent back what is owed. Staff
--  only, and like `paid` a note made after the fact: nothing here can
--  send money or see it go. What is owed is what was paid less what the
--  order now comes to (nothing, if it was cancelled), less what was
--  already refunded -- the same sum as refundDue() in app/domain.js.
-- ---------------------------------------------------------------------
create or replace function mark_refund(p_oid uuid) returns int
  language plpgsql volatile security definer set search_path = public as $fn$
declare
  st    text;
  pd    boolean;
  amt   int;
  total int;
  done  int;
  due   int;
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  select status, paid, paid_amount, grand, refunded into st, pd, amt, total, done
    from orders where id = p_oid for update;
  if st is null then raise exception 'NO_SUCH_ORDER'; end if;
  if not pd or amt is null then raise exception 'NOTHING_TO_REFUND'; end if;
  due := amt - (case when st in ('cancelled', 'abandoned') then 0 else total end) - done;
  if due <= 0 then raise exception 'NOTHING_TO_REFUND'; end if;
  update orders set refunded = refunded + due, refunded_at = now(), updated_at = now()
   where id = p_oid;
  return due;
end;
$fn$;

-- ---------------------------------------------------------------------
--  GOING BACK (8 November 2026, the owner's ask: "they can undo the
--  status too later"). The store may move an order, or one item, back to
--  any EARLIER step of the road -- Shipped back to Packed after a wrong
--  tap. Staff only, like every move.
--
--  ⚠️ ONLY ALONG THE ROAD. A cancellation and a return are final: money
--  and stock follow them, and the store's pop-up says so before either
--  is taken. The road is the same list as LINE_ROAD in app/domain.js;
--  tools/db.pl compares both arrays below with it.
--
--  Written into the history as a step back ('back': true), so the
--  customer's timeline knows when each step really happened and draws
--  only the steps up to where the order is now. A parcel taken back
--  before Shipped loses its courier; one taken back from Delivered loses
--  its delivery stamp, because the seven-day return window counts from
--  it and must not run for a parcel that has not landed.
-- ---------------------------------------------------------------------
create or replace function step_back_order(p_oid uuid, p_to text)
  returns void language plpgsql volatile security definer set search_path = public as $fn$
declare
  road  text[] := array['sent', 'confirmed', 'packed', 'shipped', 'delivered'];
  cur   text;
  stamp text := iso_now();
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  select status into cur from orders where id = p_oid for update;
  if cur is null then raise exception 'NO_SUCH_ORDER'; end if;
  if p_to is null or not (cur = any(road)) or not (p_to = any(road))
     or array_position(road, p_to) >= array_position(road, cur) then
    raise exception 'BAD_STEP_BACK % -> %', cur, coalesce(p_to, 'nothing');
  end if;

  update orders set
    status       = p_to,
    history      = history || jsonb_build_array(jsonb_build_object('at', stamp, 'to', p_to,
                                                                   'back', true)),
    delivered_at = case when cur = 'delivered' then null else delivered_at end,
    shipment     = case when array_position(road, p_to) < array_position(road, 'shipped')
                        then null else shipment end,
    updated_at   = now()
  where id = p_oid;

  -- The items AT the order's step go back with it -- the mirror of
  -- advance_order(). An item further along on its own stays where it is:
  -- the store moves that one back on its own if it means to.
  update order_lines set
    status   = p_to,
    history  = history || jsonb_build_array(jsonb_build_object('at', stamp, 'to', p_to,
                                                               'back', true)),
    shipment = case when array_position(road, p_to) < array_position(road, 'shipped')
                    then null else shipment end
  where order_id = p_oid and status = cur;

  -- A correction the customer hears of too -- unless it is undone before
  -- the email goes, when nothing is sent at all (send_notices).
  perform touch_order(p_oid);
end;
$fn$;

create or replace function step_back_line(p_line bigint, p_to text)
  returns void language plpgsql volatile security definer set search_path = public as $fn$
declare
  road   text[] := array['sent', 'confirmed', 'packed', 'shipped', 'delivered'];
  ord_id uuid;
  lcur   text;
  stamp  text := iso_now();
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  select order_id, status into ord_id, lcur from order_lines where id = p_line for update;
  if ord_id is null then raise exception 'NO_SUCH_LINE'; end if;
  if p_to is null or not (lcur = any(road)) or not (p_to = any(road))
     or array_position(road, p_to) >= array_position(road, lcur) then
    raise exception 'BAD_STEP_BACK % -> %', lcur, coalesce(p_to, 'nothing');
  end if;

  update order_lines set
    status   = p_to,
    history  = history || jsonb_build_array(jsonb_build_object('at', stamp, 'to', p_to,
                                                               'back', true)),
    shipment = case when array_position(road, p_to) < array_position(road, 'shipped')
                    then null else shipment end
  where id = p_line;

  -- If this item is now the slowest, the order comes back with it.
  perform roll_up_order(ord_id, stamp);
end;
$fn$;

-- ---------------------------------------------------------------------
--  REVIEWS (8 November 2026, the owner's ask). Once an item has been
--  delivered, its customer may rate it -- 1 to 5 stars, and a few words
--  if they like -- and rate the delivery of the order. Each product's
--  average and its reviews are shown to everybody; the store sees all of
--  it, and may hide a review from the shop.
--
--  ⚠️ WHAT EVERYBODY MAY READ, AND NOTHING MORE. A product page is read
--  by people with no session at all, so the public gets exactly two
--  functions, granted to anon: product_reviews() and rating_summary().
--  They return the stars, the words, a first name and an initial ("Asha
--  M.") and the day -- never the order, the phone, the address or who
--  wrote it. tools/db.pl fails if anything else is granted to anon, or if
--  either function's body names a customer's column. The tables are read
--  by their author and by the store only.
-- ---------------------------------------------------------------------
create table if not exists reviews (
  id         bigserial primary key,
  line_id    bigint not null unique references order_lines on delete cascade,
  order_id   uuid not null references orders on delete cascade,
  user_id    uuid references auth.users on delete set null,
  pid        text not null,
  rating     int  not null check (rating between 1 and 5),
  body       text not null default '' check (char_length(body) <= 1000),
  author     text not null default '',
  hidden     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reviews_pid on reviews (pid, created_at desc);
alter table reviews enable row level security;

create table if not exists delivery_ratings (
  order_id   uuid primary key references orders on delete cascade,
  user_id    uuid references auth.users on delete set null,
  rating     int  not null check (rating between 1 and 5),
  body       text not null default '' check (char_length(body) <= 1000),
  courier    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table delivery_ratings enable row level security;

drop policy if exists review_read on reviews;
create policy review_read on reviews for select
  using (user_id = auth.uid() or is_staff());
drop policy if exists drate_read on delivery_ratings;
create policy drate_read on delivery_ratings for select
  using (user_id = auth.uid() or is_staff());

-- "Asha M." from the name on the parcel: the first word and the last
-- word's initial; one word stays as it is. Granted to nobody.
create or replace function review_author(p_name text) returns text
  language sql immutable set search_path = public as $fn$
  select case
    when coalesce(trim(p_name), '') = '' then 'A customer'
    when position(' ' in trim(p_name)) = 0 then left(trim(p_name), 40)
    else left(split_part(trim(p_name), ' ', 1), 40) || ' '
         || upper(left(regexp_replace(trim(p_name), '^.*\s', ''), 1)) || '.'
  end
$fn$;

-- A product's review: its customer, an item delivered (or returned), 1 to
-- 5. One per item bought; sent again, it changes, and stays hidden if the
-- store hid it.
create or replace function submit_review(p_line bigint, p_rating int, p_body text default '')
  returns bigint language plpgsql volatile security definer set search_path = public as $fn$
declare
  l   record;
  rid bigint;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  select ol.id, ol.order_id, ol.pid, ol.status, o.user_id, o.cust_name into l
    from order_lines ol join orders o on o.id = ol.order_id
   where ol.id = p_line;
  if not found or l.user_id is distinct from auth.uid() then raise exception 'NOT_YOURS'; end if;
  if l.status not in ('delivered', 'returned') then raise exception 'NOT_DELIVERED'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'BAD_RATING'; end if;
  insert into reviews (line_id, order_id, user_id, pid, rating, body, author)
  values (l.id, l.order_id, auth.uid(), l.pid, p_rating,
          left(coalesce(trim(p_body), ''), 1000), review_author(l.cust_name))
  on conflict (line_id) do update set
    rating = excluded.rating, body = excluded.body, updated_at = now()
  returning id into rid;
  return rid;
end;
$fn$;

-- The delivery's rating: its customer, once something in the order has
-- been delivered. The courier is copied in as it stood, for the store.
create or replace function rate_delivery(p_oid uuid, p_rating int, p_body text default '')
  returns void language plpgsql volatile security definer set search_path = public as $fn$
declare
  o record;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  select id, user_id, status, shipment into o from orders where id = p_oid;
  if not found or o.user_id is distinct from auth.uid() then raise exception 'NOT_YOURS'; end if;
  if o.status not in ('delivered', 'returned') and not exists (
       select 1 from order_lines where order_id = p_oid and status in ('delivered', 'returned')) then
    raise exception 'NOT_DELIVERED';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'BAD_RATING'; end if;
  insert into delivery_ratings (order_id, user_id, rating, body, courier)
  values (p_oid, auth.uid(), p_rating, left(coalesce(trim(p_body), ''), 1000),
          left(coalesce(nullif(o.shipment->>'courier', ''),
                        (select shipment->>'courier' from order_lines
                          where order_id = p_oid and coalesce(shipment->>'courier', '') <> ''
                          limit 1), ''), 60))
  on conflict (order_id) do update set
    rating = excluded.rating, body = excluded.body, courier = excluded.courier,
    updated_at = now();
end;
$fn$;

-- What everybody may read: a product's visible reviews, newest first...
create or replace function product_reviews(p_pid text)
  returns table (rating int, body text, author text, created_at timestamptz)
  language sql stable security definer set search_path = public as $fn$
  select r.rating, r.body, r.author, r.created_at
    from reviews r
   where r.pid = p_pid and not r.hidden
   order by r.created_at desc
   limit 50
$fn$;

-- ...and every product's average, for the cards and the product page.
create or replace function rating_summary()
  returns table (pid text, average numeric, ratings int)
  language sql stable security definer set search_path = public as $fn$
  select r.pid, round(avg(r.rating)::numeric, 1), count(*)::int
    from reviews r
   where not r.hidden
   group by r.pid
$fn$;

-- The store takes a review out of the shop, or puts it back. Staff only.
create or replace function hide_review(p_id bigint, p_hidden boolean)
  returns void language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  if p_hidden is null then raise exception 'BAD_HIDDEN'; end if;
  update reviews set hidden = p_hidden where id = p_id;
  if not found then raise exception 'NO_SUCH_REVIEW'; end if;
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
                    addresses, handovers, reviews, delivery_ratings, products,
                    interest, notices
  from anon, authenticated;
revoke all on sequence order_seq, order_lines_id_seq, reviews_id_seq, interest_id_seq,
                       notices_id_seq from anon, authenticated;

grant usage on schema public to authenticated;
grant select on staff, orders, order_lines, addresses, reviews, delivery_ratings, interest
  to authenticated;

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
revoke all on function roll_up_order(uuid, text)              from public, anon, authenticated;
revoke all on function advance_line(bigint, text, text, text) from public, anon, authenticated;
revoke all on function mark_refund(uuid)                      from public, anon, authenticated;
revoke all on function step_back_order(uuid, text)            from public, anon, authenticated;
revoke all on function step_back_line(bigint, text)           from public, anon, authenticated;
revoke all on function review_author(text)                    from public, anon, authenticated;
revoke all on function submit_review(bigint, int, text)       from public, anon, authenticated;
revoke all on function rate_delivery(uuid, int, text)         from public, anon, authenticated;
revoke all on function product_reviews(text)                  from public, anon, authenticated;
revoke all on function rating_summary()                       from public, anon, authenticated;
revoke all on function hide_review(bigint, boolean)           from public, anon, authenticated;
revoke all on function whole(jsonb)                          from public, anon, authenticated;
revoke all on function sku_key(jsonb)                        from public, anon, authenticated;
revoke all on function sku_keys(jsonb)                       from public, anon, authenticated;
revoke all on function product_json(products, boolean)       from public, anon, authenticated;
revoke all on function catalogue()                           from public, anon, authenticated;
revoke all on function store_products()                      from public, anon, authenticated;
revoke all on function save_product(jsonb)                   from public, anon, authenticated;
revoke all on function set_price(text, int, int)             from public, anon, authenticated;
revoke all on function set_stock(text, jsonb)                from public, anon, authenticated;
revoke all on function set_status(text, text)                from public, anon, authenticated;
revoke all on function set_stock_mode(text, text)            from public, anon, authenticated;
revoke all on function can_buy(text, text)                   from public, anon, authenticated;
revoke all on function wake_interest(text)                   from public, anon, authenticated;
revoke all on function register_interest(text, text)         from public, anon, authenticated;
revoke all on function drop_interest(text, text)             from public, anon, authenticated;
revoke all on function order_state(uuid)                     from public, anon, authenticated;
revoke all on function touch_order(uuid)                     from public, anon, authenticated;
revoke all on function html_escape(text)                     from public, anon, authenticated;
revoke all on function sku_label(jsonb, text)                from public, anon, authenticated;
revoke all on function order_mail(uuid, text)                from public, anon, authenticated;
revoke all on function interest_mail(bigint, text)           from public, anon, authenticated;
revoke all on function send_notices()                        from public, anon, authenticated;
revoke all on function send_notices_now()                    from public, anon, authenticated;
revoke all on function mail_status()                         from public, anon, authenticated;
revoke all on function notices_log()                         from public, anon, authenticated;
revoke all on function take_lines(jsonb)                     from public, anon, authenticated;
revoke all on function restock_line(bigint)                  from public, anon, authenticated;

-- is_staff() runs inside the read policies, so the reader must be
-- allowed to call it. The rest are the only writes there are.
-- signed_in(), roll_up_order(), take_lines(), restock_line(), the catalogue
-- helpers (whole, sku_key, sku_keys, product_json, can_buy, wake_interest)
-- and the email ones (order_state, touch_order, html_escape, sku_label,
-- order_mail, interest_mail, send_notices) are granted to nobody: they are
-- only ever called from inside the functions above, which run as their
-- owner -- and send_notices() by pg_cron, as the database itself.
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
grant execute on function advance_line(bigint, text, text, text) to authenticated;
grant execute on function mark_refund(uuid)                     to authenticated;
grant execute on function step_back_order(uuid, text)           to authenticated;
grant execute on function step_back_line(bigint, text)          to authenticated;
grant execute on function submit_review(bigint, int, text)      to authenticated;
grant execute on function rate_delivery(uuid, int, text)        to authenticated;
grant execute on function hide_review(bigint, boolean)          to authenticated;
-- The store's catalogue (8 November 2026): each checks is_staff() first.
grant execute on function store_products()                      to authenticated;
grant execute on function save_product(jsonb)                   to authenticated;
grant execute on function set_price(text, int, int)             to authenticated;
grant execute on function set_stock(text, jsonb)                to authenticated;
grant execute on function set_status(text, text)               to authenticated;
grant execute on function set_stock_mode(text, text)           to authenticated;
-- Emails (9 November 2026): the store sees what went and sends what waits;
-- a signed-in customer asks to be told, or not.
grant execute on function send_notices_now()                   to authenticated;
grant execute on function mail_status()                        to authenticated;
grant execute on function notices_log()                        to authenticated;
grant execute on function register_interest(text, text)        to authenticated;
grant execute on function drop_interest(text, text)            to authenticated;

-- ⚠️ WHAT A PAGE WITH NO SESSION MAY CALL (8 November 2026): what
-- everybody may read of the reviews, and the catalogue itself -- the
-- products on show, their prices and their stock up to 10. A product page
-- is open to anyone, and browsing makes no session. tools/db.pl fails on
-- any other grant to anon.
grant usage on schema public to anon;
grant execute on function product_reviews(text)                 to anon, authenticated;
grant execute on function rating_summary()                      to anon, authenticated;
grant execute on function catalogue()                            to anon, authenticated;

-- =====================================================================
--  THE FIRST CATALOGUE (8 November 2026). See tools/seed.pl.
-- =====================================================================
-- seed.pl BEGIN -- written by tools/seed.pl from app/data/catalog.json; never edit by hand
--
-- THE FIRST CATALOGUE: 11 products, into an EMPTY products table only.
-- Once the store has products, this inserts nothing, so the store's own
-- prices, stock and products survive every later run of this file.
insert into products (id, slug, name, cat, sub, price, mrp, short_desc, descr, specs, variants, img, skus, badges, tags, size_chart, kind, ship_class, popularity, added_on, list_order, stock_mode)
select v.* from (values
  ('p-wd-flutter-midi', 'flutter-sleeve-midi-dress', 'Flutter-Sleeve Midi Dress', 'women', 'women-dresses', 1899, 2799, 'A V-neck, flutter sleeves and buttons all the way down, with pockets.', 'A V-neck midi with small flutter sleeves, buttons from the neckline to the hem and a seam at the natural waist. The skirt falls straight to mid-calf, and there are pockets in the side seams.', '[{"k":"Neckline","v":"V-neck"},{"k":"Sleeve","v":"Short, flutter"},{"k":"Closure","v":"Buttons down the front"},{"k":"Length","v":"Midi, to mid-calf"},{"k":"Pockets","v":"Two, in the side seams"}]'::jsonb, '{"colour":[{"delta":0,"id":"sage","img":0,"label":"Sage","swatch":"#989488"},{"delta":0,"id":"rust","img":2,"label":"Rust","swatch":"#653122"}],"size":[{"delta":0,"id":"s","label":"S"},{"delta":0,"id":"m","label":"M"},{"delta":0,"id":"l","label":"L"},{"delta":50,"id":"xl","label":"XL"},{"delta":100,"id":"xxl","label":"XXL"}]}'::jsonb, '["img/products/dress-flutter-midi-sage-1.jpg","img/products/dress-flutter-midi-sage-2.jpg","img/products/dress-flutter-midi-rust-1.jpg","img/products/dress-flutter-midi-rust-2.jpg"]'::jsonb, '{"rust/l":3,"rust/m":10,"rust/s":11,"rust/xl":8,"rust/xxl":5,"sage/l":7,"sage/m":5,"sage/s":12,"sage/xl":4,"sage/xxl":12}'::jsonb, '[]'::jsonb, '["dress","midi","v-neck","flutter-sleeve","button-front","pockets"]'::jsonb, 'women-dress', 'goods', 'std', 84, date '2026-11-08', 1, 'always'),
  ('p-wd-short-button', 'button-front-short-dress', 'Button-Front Short Dress', 'women', 'women-dresses', 1599, 2299, 'A deep V, wide short sleeves and a buttoned waistband that ties at the back.', 'Wide short sleeves cut into the body and a deep V, gathered into a buttoned waistband that ties at the back, so the fit at the waist is yours to set. The skirt buttons down the front, flares a little and stops above the knee. Pockets in the side seams.', '[{"k":"Neckline","v":"Deep V-neck"},{"k":"Sleeve","v":"Short, cut into the body"},{"k":"Waist","v":"Buttoned band, ties at the back"},{"k":"Length","v":"Above the knee"},{"k":"Pockets","v":"Two, in the side seams"}]'::jsonb, '{"colour":[{"delta":0,"id":"rust","img":0,"label":"Rust","swatch":"#C48268"},{"delta":0,"id":"navy","img":1,"label":"Navy","swatch":"#1C2939"},{"delta":0,"id":"sage","img":3,"label":"Sage","swatch":"#ADAEA7"}],"size":[{"delta":0,"id":"s","label":"S"},{"delta":0,"id":"m","label":"M"},{"delta":0,"id":"l","label":"L"},{"delta":50,"id":"xl","label":"XL"},{"delta":100,"id":"xxl","label":"XXL"}]}'::jsonb, '["img/products/dress-short-rust-1.jpg","img/products/dress-short-navy-1.jpg","img/products/dress-short-navy-2.jpg","img/products/dress-short-sage-1.jpg"]'::jsonb, '{"navy/l":14,"navy/m":10,"navy/s":9,"navy/xl":7,"navy/xxl":6,"rust/l":14,"rust/m":4,"rust/s":9,"rust/xl":3,"rust/xxl":12,"sage/l":13,"sage/m":4,"sage/s":14,"sage/xl":7,"sage/xxl":3}'::jsonb, '[]'::jsonb, '["dress","short","v-neck","button-front","tie-back","pockets"]'::jsonb, 'women-dress', 'goods', 'std', 78, date '2026-11-08', 2, 'always'),
  ('p-wd-popover', 'popover-shirt-dress', 'Popover Shirt Dress', 'women', 'women-dresses', 1799, 2499, 'A shirt collar, a half placket and long sleeves that roll up and button in place.', 'A shirt dress that goes on over the head: a collar, a placket that buttons halfway down, and long sleeves with a tab to hold them rolled. Straight and easy through the body, ending above the knee.', '[{"k":"Collar","v":"Shirt collar"},{"k":"Closure","v":"Half placket, goes on over the head"},{"k":"Sleeve","v":"Long, with roll-up tabs"},{"k":"Fit","v":"Straight and relaxed"},{"k":"Length","v":"Above the knee"}]'::jsonb, '{"colour":[{"delta":0,"id":"olive","img":0,"label":"Olive","swatch":"#887C69"},{"delta":0,"id":"navy","img":2,"label":"Navy","swatch":"#1B2737"}],"size":[{"delta":0,"id":"s","label":"S"},{"delta":0,"id":"m","label":"M"},{"delta":0,"id":"l","label":"L"},{"delta":50,"id":"xl","label":"XL"},{"delta":100,"id":"xxl","label":"XXL"}]}'::jsonb, '["img/products/dress-popover-olive-1.jpg","img/products/dress-popover-olive-2.jpg","img/products/dress-popover-navy-1.jpg","img/products/dress-popover-navy-2.jpg","img/products/dress-popover-navy-3.jpg"]'::jsonb, '{"navy/l":11,"navy/m":10,"navy/s":4,"navy/xl":6,"navy/xxl":10,"olive/l":12,"olive/m":9,"olive/s":11,"olive/xl":13,"olive/xxl":12}'::jsonb, '[]'::jsonb, '["dress","shirt-dress","popover","long-sleeve"]'::jsonb, 'women-dress', 'goods', 'std', 71, date '2026-11-08', 3, 'always'),
  ('p-wt-relaxed-shirt', 'relaxed-short-sleeve-shirt', 'Relaxed Short-Sleeve Shirt', 'women', 'women-tops', 999, 1499, 'A collared shirt with short sleeves cut into the body and a gathered back.', 'An easy collared shirt with short sleeves cut into the body, buttons all the way down and a yoke at the back, gathered for room. The hem curves, so it can be worn loose or tucked in.', '[{"k":"Collar","v":"Shirt collar"},{"k":"Sleeve","v":"Short, cut into the body"},{"k":"Closure","v":"Buttons down the front"},{"k":"Back","v":"Gathered under a yoke"},{"k":"Hem","v":"Curved"}]'::jsonb, '{"colour":[{"delta":0,"id":"white","img":0,"label":"White","swatch":"#DEDEDE"},{"delta":0,"id":"rust","img":2,"label":"Rust","swatch":"#BE705F"},{"delta":0,"id":"navy","img":4,"label":"Navy","swatch":"#354153"},{"delta":0,"id":"sand","img":6,"label":"Sand","swatch":"#E1D6C8"}],"size":[{"delta":0,"id":"s","label":"S"},{"delta":0,"id":"m","label":"M"},{"delta":0,"id":"l","label":"L"},{"delta":50,"id":"xl","label":"XL"},{"delta":100,"id":"xxl","label":"XXL"}]}'::jsonb, '["img/products/top-relaxed-white-1.jpg","img/products/top-relaxed-white-2.jpg","img/products/top-relaxed-rust-1.jpg","img/products/top-relaxed-rust-2.jpg","img/products/top-relaxed-navy-1.jpg","img/products/top-relaxed-navy-2.jpg","img/products/top-relaxed-sand-1.jpg","img/products/top-relaxed-sand-2.jpg"]'::jsonb, '{"navy/l":9,"navy/m":9,"navy/s":8,"navy/xl":6,"navy/xxl":11,"rust/l":9,"rust/m":13,"rust/s":12,"rust/xl":8,"rust/xxl":4,"sand/l":13,"sand/m":6,"sand/s":5,"sand/xl":5,"sand/xxl":7,"white/l":10,"white/m":7,"white/s":3,"white/xl":4,"white/xxl":14}'::jsonb, '[]'::jsonb, '["shirt","top","short-sleeve","collar","relaxed"]'::jsonb, 'women-top', 'goods', 'std', 88, date '2026-11-08', 4, 'always'),
  ('p-wt-utility-shirt', 'utility-shirt', 'Utility Shirt', 'women', 'women-tops', 1399, 1999, 'Two flap pockets on the chest and long sleeves that roll up and button.', 'A long-sleeved shirt with two buttoned flap pockets on the chest and tabs to hold the sleeves rolled up. Cut loose and a little long, with a curved hem: over trousers, or open as a light layer.', '[{"k":"Collar","v":"Shirt collar"},{"k":"Pockets","v":"Two flap pockets on the chest"},{"k":"Sleeve","v":"Long, with roll-up tabs"},{"k":"Fit","v":"Relaxed"},{"k":"Hem","v":"Curved"}]'::jsonb, '{"colour":[{"delta":0,"id":"olive","img":0,"label":"Olive","swatch":"#7D7158"},{"delta":0,"id":"navy","img":2,"label":"Navy","swatch":"#293345"}],"size":[{"delta":0,"id":"s","label":"S"},{"delta":0,"id":"m","label":"M"},{"delta":0,"id":"l","label":"L"},{"delta":50,"id":"xl","label":"XL"},{"delta":100,"id":"xxl","label":"XXL"}]}'::jsonb, '["img/products/top-utility-olive-1.jpg","img/products/top-utility-olive-2.jpg","img/products/top-utility-navy-1.jpg","img/products/top-utility-navy-2.jpg","img/products/top-utility-navy-3.jpg"]'::jsonb, '{"navy/l":12,"navy/m":7,"navy/s":11,"navy/xl":7,"navy/xxl":9,"olive/l":4,"olive/m":3,"olive/s":8,"olive/xl":14,"olive/xxl":11}'::jsonb, '[]'::jsonb, '["shirt","top","long-sleeve","utility","pockets"]'::jsonb, 'women-top', 'goods', 'std', 69, date '2026-11-08', 5, 'always'),
  ('p-wb-drawstring-shorts', 'drawstring-shorts', 'Drawstring Shorts', 'women', 'women-bottoms', 799, 1199, 'An elastic waist with a drawstring, pockets at the sides and patch pockets at the back.', 'Pull-on shorts with an elastic waistband and a drawstring to tighten it, pockets at the sides and two patch pockets at the back. A short, easy leg.', '[{"k":"Waist","v":"Elastic, with a drawstring"},{"k":"Pockets","v":"At the sides, and two patch pockets at the back"},{"k":"Fit","v":"Relaxed"},{"k":"Closure","v":"Pulls on"}]'::jsonb, '{"colour":[{"delta":0,"id":"navy","img":0,"label":"Navy","swatch":"#1E293B"},{"delta":0,"id":"rust","img":1,"label":"Rust","swatch":"#954538"},{"delta":0,"id":"stone","img":3,"label":"Stone","swatch":"#CFC3B3"}],"size":[{"delta":0,"id":"s","label":"S"},{"delta":0,"id":"m","label":"M"},{"delta":0,"id":"l","label":"L"},{"delta":50,"id":"xl","label":"XL"},{"delta":100,"id":"xxl","label":"XXL"}]}'::jsonb, '["img/products/shorts-drawstring-navy-1.jpg","img/products/shorts-drawstring-rust-1.jpg","img/products/shorts-drawstring-rust-2.jpg","img/products/shorts-drawstring-stone-1.jpg"]'::jsonb, '{"navy/l":3,"navy/m":3,"navy/s":4,"navy/xl":6,"navy/xxl":14,"rust/l":10,"rust/m":6,"rust/s":3,"rust/xl":8,"rust/xxl":10,"stone/l":4,"stone/m":10,"stone/s":4,"stone/xl":13,"stone/xxl":8}'::jsonb, '[]'::jsonb, '["shorts","drawstring","elastic-waist","pockets"]'::jsonb, 'women-bottom', 'goods', 'std', 80, date '2026-11-08', 6, 'always'),
  ('p-ws-shirt-shorts-set', 'shirt-and-shorts-set', 'Shirt and Shorts Set', 'women', 'women-sets', 1999, 2899, 'A short-sleeved shirt and matching drawstring shorts, sold together.', 'Two pieces in one colour: a collared shirt with short sleeves and a gathered back, and pull-on shorts with an elastic drawstring waist and patch pockets at the back. Wear them together, or each with something else.', '[{"k":"In the set","v":"A shirt and a pair of shorts"},{"k":"Shirt","v":"Collar, short sleeves, buttons down the front"},{"k":"Shorts","v":"Elastic drawstring waist, patch pockets at the back"},{"k":"Fit","v":"Relaxed"}]'::jsonb, '{"colour":[{"delta":0,"id":"butter","img":0,"label":"Butter","swatch":"#E8D9BC"},{"delta":0,"id":"sage","img":3,"label":"Sage","swatch":"#767868"}],"size":[{"delta":0,"id":"s","label":"S"},{"delta":0,"id":"m","label":"M"},{"delta":0,"id":"l","label":"L"},{"delta":50,"id":"xl","label":"XL"},{"delta":100,"id":"xxl","label":"XXL"}]}'::jsonb, '["img/products/set-shirt-shorts-butter-1.jpg","img/products/set-shirt-shorts-butter-2.jpg","img/products/set-shirt-shorts-butter-3.jpg","img/products/set-shirt-shorts-sage-1.jpg"]'::jsonb, '{"butter/l":11,"butter/m":7,"butter/s":8,"butter/xl":11,"butter/xxl":10,"sage/l":8,"sage/m":13,"sage/s":14,"sage/xl":4,"sage/xxl":8}'::jsonb, '[]'::jsonb, '["set","co-ord","shirt","shorts","matching"]'::jsonb, 'women-set', 'goods', 'std', 74, date '2026-11-08', 7, 'always'),
  ('p-wb-cargo-trousers', 'cargo-trousers', 'Cargo Trousers', 'women', 'women-bottoms', 1499, 2199, 'A drawstring waist, cargo pockets on the thighs and a straight, ankle-length leg.', 'Pull-on trousers with an elastic drawstring waist, deep pockets at the sides and a flap cargo pocket on each thigh. The leg is straight and stops at the ankle.', '[{"k":"Waist","v":"Elastic, with a drawstring"},{"k":"Pockets","v":"At the sides, and a flap cargo pocket on each thigh"},{"k":"Leg","v":"Straight, ankle length"},{"k":"Closure","v":"Pulls on"}]'::jsonb, '{"colour":[{"delta":0,"id":"sage","img":0,"label":"Sage","swatch":"#97907B"},{"delta":0,"id":"stone","img":2,"label":"Stone","swatch":"#E0D3C6"}],"size":[{"delta":0,"id":"s","label":"S"},{"delta":0,"id":"m","label":"M"},{"delta":0,"id":"l","label":"L"},{"delta":50,"id":"xl","label":"XL"},{"delta":100,"id":"xxl","label":"XXL"}]}'::jsonb, '["img/products/trousers-cargo-sage-1.jpg","img/products/trousers-cargo-sage-2.jpg","img/products/trousers-cargo-stone-1.jpg","img/products/trousers-cargo-stone-2.jpg"]'::jsonb, '{"sage/l":13,"sage/m":11,"sage/s":3,"sage/xl":7,"sage/xxl":6,"stone/l":12,"stone/m":6,"stone/s":9,"stone/xl":9,"stone/xxl":10}'::jsonb, '[]'::jsonb, '["trousers","cargo","drawstring","pockets"]'::jsonb, 'women-bottom', 'goods', 'std', 76, date '2026-11-08', 8, 'always'),
  ('p-wb-wide-trousers', 'drawstring-wide-leg-trousers', 'Drawstring Wide-Leg Trousers', 'women', 'women-bottoms', 1299, 1899, 'An elastic drawstring waist and a wide, full-length leg, with pockets.', 'Easy pull-on trousers: an elastic waistband with a drawstring, pockets at the sides and one at the back, and a wide leg that falls straight to the floor.', '[{"k":"Waist","v":"Elastic, with a drawstring"},{"k":"Pockets","v":"At the sides, and one at the back"},{"k":"Leg","v":"Wide, full length"},{"k":"Closure","v":"Pulls on"}]'::jsonb, '{"colour":[{"delta":0,"id":"navy","img":0,"label":"Navy","swatch":"#202A3B"},{"delta":0,"id":"sage","img":5,"label":"Sage","swatch":"#887C66"},{"delta":0,"id":"stone","img":7,"label":"Stone","swatch":"#DDD3C6"}],"size":[{"delta":0,"id":"s","label":"S"},{"delta":0,"id":"m","label":"M"},{"delta":0,"id":"l","label":"L"},{"delta":50,"id":"xl","label":"XL"},{"delta":100,"id":"xxl","label":"XXL"}]}'::jsonb, '["img/products/trousers-wide-navy-1.jpg","img/products/trousers-wide-navy-2.jpg","img/products/trousers-wide-navy-3.jpg","img/products/trousers-wide-navy-4.jpg","img/products/trousers-wide-navy-5.jpg","img/products/trousers-wide-sage-1.jpg","img/products/trousers-wide-sage-2.jpg","img/products/trousers-wide-stone-1.jpg","img/products/trousers-wide-stone-2.jpg"]'::jsonb, '{"navy/l":13,"navy/m":6,"navy/s":8,"navy/xl":8,"navy/xxl":10,"sage/l":8,"sage/m":7,"sage/s":9,"sage/xl":9,"sage/xxl":7,"stone/l":11,"stone/m":8,"stone/s":6,"stone/xl":9,"stone/xxl":8}'::jsonb, '[]'::jsonb, '["trousers","wide-leg","drawstring","pockets"]'::jsonb, 'women-bottom', 'goods', 'std', 82, date '2026-11-08', 9, 'always'),
  ('p-ws-tie-jumpsuit', 'tie-waist-jumpsuit', 'Tie-Waist Jumpsuit', 'women', 'women-sets', 2199, 2999, 'A V-neck, short sleeves and a tie at the waist you set yourself.', 'A one-piece with a V-neck, short sleeves and a fabric tie at the waist, so the fit is yours to set. Easy through the body, with a tapered leg that ends at the ankle.', '[{"k":"Neckline","v":"V-neck"},{"k":"Sleeve","v":"Short"},{"k":"Waist","v":"A fabric tie"},{"k":"Leg","v":"Tapered, ankle length"},{"k":"Fit","v":"Easy through the body"}]'::jsonb, '{"colour":[{"delta":0,"id":"sage","img":0,"label":"Sage","swatch":"#AEA28C"},{"delta":0,"id":"black","img":2,"label":"Black","swatch":"#212023"}],"size":[{"delta":0,"id":"s","label":"S"},{"delta":0,"id":"m","label":"M"},{"delta":0,"id":"l","label":"L"},{"delta":50,"id":"xl","label":"XL"},{"delta":100,"id":"xxl","label":"XXL"}]}'::jsonb, '["img/products/jumpsuit-tie-waist-sage-1.jpg","img/products/jumpsuit-tie-waist-sage-2.jpg","img/products/jumpsuit-tie-waist-black-1.jpg","img/products/jumpsuit-tie-waist-black-2.jpg"]'::jsonb, '{"black/l":9,"black/m":3,"black/s":6,"black/xl":5,"black/xxl":5,"sage/l":10,"sage/m":11,"sage/s":5,"sage/xl":6,"sage/xxl":4}'::jsonb, '[]'::jsonb, '["jumpsuit","one-piece","tie-waist","v-neck"]'::jsonb, 'women-set', 'goods', 'std', 67, date '2026-11-08', 10, 'always'),
  ('p-ms-camp-collar', 'camp-collar-shirt', 'Camp-Collar Shirt', 'men', 'men-shirts', 1199, 1199, 'An open camp collar, short sleeves and a pocket on the chest.', 'A short-sleeved shirt with a flat, open camp collar, buttons down the front and one pocket on the chest. Straight at the hem, so it is meant to be worn out.', '[{"k":"Collar","v":"Camp collar, worn open"},{"k":"Sleeve","v":"Short"},{"k":"Pocket","v":"One, on the chest"},{"k":"Hem","v":"Straight, worn out"},{"k":"Fit","v":"Relaxed"}]'::jsonb, '{"colour":[{"delta":0,"id":"sage","img":0,"label":"Sage","swatch":"#857E6B"},{"delta":0,"id":"navy","img":2,"label":"Navy","swatch":"#242E3C"},{"delta":0,"id":"white","img":4,"label":"White","swatch":"#DAD7D5"}],"size":[{"delta":0,"id":"s","label":"S"},{"delta":0,"id":"m","label":"M"},{"delta":0,"id":"l","label":"L"},{"delta":50,"id":"xl","label":"XL"},{"delta":100,"id":"xxl","label":"XXL"}]}'::jsonb, '["img/products/men-camp-shirt-sage-1.jpg","img/products/men-camp-shirt-sage-2.jpg","img/products/men-camp-shirt-navy-1.jpg","img/products/men-camp-shirt-navy-2.jpg","img/products/men-camp-shirt-white-1.jpg","img/products/men-camp-shirt-white-2.jpg","img/products/men-camp-shirt-white-3.jpg"]'::jsonb, '{"navy/l":8,"navy/m":3,"navy/s":8,"navy/xl":6,"navy/xxl":11,"sage/l":6,"sage/m":13,"sage/s":7,"sage/xl":6,"sage/xxl":12,"white/l":12,"white/m":10,"white/s":11,"white/xl":7,"white/xxl":3}'::jsonb, '[]'::jsonb, '["shirt","camp-collar","short-sleeve","men"]'::jsonb, 'men-shirt', 'goods', 'std', 86, date '2026-11-08', 11, 'always')
) as v(id, slug, name, cat, sub, price, mrp, short_desc, descr, specs, variants, img, skus, badges, tags, size_chart, kind, ship_class, popularity, added_on, list_order, stock_mode)
where not exists (select 1 from products);
-- seed.pl END
