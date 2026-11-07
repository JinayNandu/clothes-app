-- =====================================================================
--  Vastra Apparel -- EMPTY THE SHOP, to start again with nothing in it.
--
--  Paste the whole file into the Supabase SQL editor and run it. The
--  editor will warn that it deletes rows: that is what it is for.
--
--  ⚠️ IT CANNOT BE UNDONE. Every order, every saved address and every
--  account goes, and no copy is kept anywhere.
--
--  ⚠️ IT REFUSES TO RUN AFTER 9 NOVEMBER 2026 (the LATCH line below), so
--  a copy picked up by mistake later -- in place of schema.sql, say --
--  cannot empty a shop that has real customers in it. To use it again on
--  purpose, change that date, and only that.
--
--  ⚠️ AND IT REFUSES ANY DATABASE BUT THIS SHOP'S. Check the project name
--  at the top left of the SQL editor first: the clothes shop's project,
--  ref tquymsewhzfawjkyysax -- never Milan's. Opened from
--  https://supabase.com/dashboard/project/tquymsewhzfawjkyysax/sql/new
--  it is the right one.
--
--  WHAT IT EMPTIES
--    orders, order_lines   every order and its items
--    addresses             every saved address
--    handovers             hand-over tickets between phones
--    claim_attempts        the store code's tries, so nobody is waiting
--    staff                 every phone let into the store: open the store
--                          page afterwards and type the store code again
--    auth.users            every account and every guest session: signing
--                          in with an email afterwards makes a NEW account
--  and it starts the order numbers again at VA-0001.
--
--  WHAT IT KEEPS
--    shop_secret           the store code -- it still opens the store
--    every table, function and rule; schema.sql needs no second run
--    the email sender and both templates, which live in the dashboard
--
--  Everything happens together or not at all: one error anywhere and
--  nothing is deleted. The last thing it shows is what is left -- every
--  count should say 0.
--
--  AFTERWARDS, on each phone that used the shop: the page may still think
--  it is signed in to an account that no longer exists. Profile -> "Sign
--  out of this phone", then "Clear this browser". tools/db.pl fails if
--  this file ever touches the store code or loses its latch.
-- =====================================================================
drop table if exists pg_temp.reset_report;
create temp table reset_report (step int, what text, left_now text, note text);

do $reset$
declare
  gone  boolean := false;
  why   text := '';
  users text;
begin
  -- LATCH: the last day this file empties anything.
  if (now() at time zone 'Asia/Kolkata')::date > date '2026-11-09' then
    raise exception 'NOTHING DELETED: reset.sql only runs until 9 November 2026, so an old copy cannot empty a shop with real customers. To run it again on purpose, change the date on the LATCH line.';
  end if;

  -- THIS SHOP'S DATABASE AND NO OTHER (8 November 2026). A dashboard link
  -- can open whichever project was used last, and Milan's has tables of
  -- the same names. So before a single row goes: order codes minted as
  -- VA-, and the tables and functions only this shop has.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders'
                    and column_name = 'code' and generation_expression like '%''VA-''%')
     or to_regclass('public.handovers') is null
     or to_regclass('public.claim_attempts') is null
     or to_regprocedure('public.step_back_order(uuid, text)') is null then
    raise exception 'NOTHING DELETED: this is not the Vastra Apparel database. Look at the project name at the top left of the SQL editor: it must be the clothes shop''s project (tquymsewhzfawjkyysax). Open that one and run this there.';
  end if;

  delete from order_lines;
  delete from orders;
  delete from addresses;
  delete from handovers;
  delete from claim_attempts;
  delete from staff;
  -- The next order is VA-0001 again. Nothing is left that could clash.
  perform setval('order_seq', 1, false);
  perform setval('order_lines_id_seq', 1, false);

  -- The accounts, last, and on their own: if this project does not let the
  -- SQL editor delete them, everything above still happens, and the
  -- report says to delete them in Authentication -> Users instead.
  begin
    delete from auth.users;
    gone := true;
  exception when others then
    why := sqlerrm;
  end;
  begin
    select count(*)::text into users from auth.users;
  exception when others then
    users := '?';
  end;

  insert into reset_report values
    (1, 'Orders',                    (select count(*)::text from orders), ''),
    (2, 'Items in orders',           (select count(*)::text from order_lines), ''),
    (3, 'Saved addresses',           (select count(*)::text from addresses), ''),
    (4, 'Accounts and guest sessions', users,
        case when gone then 'Signing in with an email now makes a new account.'
             else 'NOT DELETED (' || why || '). Delete them in Authentication -> Users.' end),
    (5, 'Phones let into the store', (select count(*)::text from staff),
        'Open the store page and type the store code again.'),
    (6, 'Hand-over tickets',         (select count(*)::text from handovers), ''),
    (7, 'Store code tries',          (select count(*)::text from claim_attempts), ''),
    (8, 'The next order',            'VA-0001', ''),
    (9, 'The store code',            'kept', 'Unchanged: it still opens the store.');
end $reset$;

select what, left_now, note from reset_report order by step;
