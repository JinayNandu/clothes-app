-- =====================================================================
--  Vastra Apparel -- a self-test of each item's status, cancelling one
--  item, and refunds, run ON THE REAL DATABASE, and saving NOTHING.
--
--  Paste the whole file into the Supabase SQL editor and run it, AFTER
--  schema.sql. It acts as the store -- the first phone let in with the
--  store code -- makes four test orders of its own, walks them through
--  every rule below, and then undoes all of it by ending in an error on
--  purpose. The message you want is:
--
--      ALL GOOD -- every check passed, and nothing was saved
--
--  Any other message names the check that failed. Either way the
--  database is exactly as it was: the test orders use their own numbers
--  (VA-9001 and up) and their own item ids, so no real order code or
--  sequence is touched, and the error rolls every row back.
--
--  It needs no code and no key: it reads the store's own session from
--  the `staff` table, which the SQL editor may read and a page may not.
-- =====================================================================
do $test$
declare
  boss  uuid := (select user_id from staff order by added_at limit 1);
  today date := (now() at time zone 'Asia/Kolkata')::date;
  o1 uuid := gen_random_uuid();
  o2 uuid := gen_random_uuid();
  o3 uuid := gen_random_uuid();
  o4 uuid := gen_random_uuid();
  r  record;
  n  int;
begin
  if boss is null then
    raise exception 'SELFTEST CANNOT RUN: no phone has been let into the store yet. Open the store page, type the store code, then run this again.';
  end if;

  -- The test orders, made directly: place_order() is proven by every real
  -- order already, and calling it would use up real order numbers.
  insert into orders (id, seq, user_id, status, cust_name, cust_mobile, addr, city, state, pin,
                      items_total, mrp_total, saved, discount, discount_placed, shipping, bulky,
                      grand, pay_method, arrives_from, arrives_to, history)
  select o.id, o.seq, boss, 'sent', 'Self Test', '9000000000', '1 Test Street, Nowhere',
         'Bengaluru', 'Karnataka', '560001', o.items, o.mrp, o.mrp - o.items, o.disc, o.disc,
         0, 0, o.items - o.disc, 'upi', today + 5, today + 10,
         jsonb_build_array(jsonb_build_object('at', iso_now(), 'to', 'sent'))
    from (values (o1, 9001, 4000, 5500, 400),
                 (o2, 9002, 2000, 3000, 0),
                 (o3, 9003,  700, 1000, 0),
                 (o4, 9004,  500,  800, 0)) as o(id, seq, items, mrp, disc);

  insert into order_lines (id, order_id, pid, name, qty, unit_price, unit_mrp, line_total)
  values (9000000011, o1, 't1', 'Test shirt', 1, 1000, 1500, 1000),
         (9000000012, o1, 't2', 'Test dress', 1, 3000, 4000, 3000),
         (9000000021, o2, 't3', 'Test kurti', 1, 1000, 1500, 1000),
         (9000000022, o2, 't4', 'Test top',   1, 1000, 1500, 1000),
         (9000000031, o3, 't5', 'Test scarf', 1,  700, 1000,  700),
         (9000000041, o4, 't6', 'Test belt',  1,  500,  800,  500);

  -- Somebody who is NOT the store is refused, before anything else.
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(),
          'role', 'authenticated')::text, true);
  begin
    perform advance_line(9000000011, 'confirmed');
    raise exception 'SELFTEST FAILED: a stranger moved an item';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;
  begin
    perform mark_refund(o1);
    raise exception 'SELFTEST FAILED: a stranger marked a refund';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;

  -- From here on, the store.
  perform set_config('request.jwt.claim.sub', boss::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', boss,
          'role', 'authenticated')::text, true);

  -- 1. Confirming the ORDER confirms every item with it.
  perform advance_order(o1, 'confirmed');
  select count(*) into n from order_lines where order_id = o1 and status = 'confirmed';
  assert n = 2, 'SELFTEST FAILED: confirming the order confirmed ' || n || ' of 2 items';

  -- 2. One item packed: the order waits for the other.
  perform advance_line(9000000011, 'packed');
  select status into r from orders where id = o1;
  assert r.status = 'confirmed',
    'SELFTEST FAILED: packing one item moved the order to ' || r.status;

  -- 3. Paid, then the unpacked item cancelled: the order is packed, the
  --    total is what is left, the coupon shrinks in proportion, and what
  --    was paid over the new total is owed back.
  perform set_paid(o1, true, 'self test');
  perform advance_line(9000000012, 'cancelled');
  select * into r from orders where id = o1;
  assert r.status = 'packed', 'SELFTEST FAILED: the order should be packed, is ' || r.status;
  assert r.items_total = 1000, 'SELFTEST FAILED: items should be 1000, are ' || r.items_total;
  assert r.discount = 100, 'SELFTEST FAILED: the coupon should be 100, is ' || r.discount;
  assert r.grand = 900, 'SELFTEST FAILED: the total should be 900, is ' || r.grand;
  assert r.paid_amount = 3600, 'SELFTEST FAILED: paid should be 3600, is ' || coalesce(r.paid_amount::text, 'empty');
  assert r.history @> '[{"to": "packed"}]'::jsonb,
    'SELFTEST FAILED: the order history has no Packed step';

  -- 4. The refund: 3600 paid, 900 owed, 2700 back -- once.
  n := mark_refund(o1);
  assert n = 2700, 'SELFTEST FAILED: the refund should be 2700, is ' || n;
  begin
    perform mark_refund(o1);
    raise exception 'SELFTEST FAILED: a refund was marked twice';
  exception when others then
    if sqlerrm <> 'NOTHING_TO_REFUND' then raise; end if;
  end;

  -- 5. A cancelled item stays cancelled.
  begin
    perform advance_line(9000000012, 'packed');
    raise exception 'SELFTEST FAILED: a cancelled item was moved on';
  exception when others then
    if sqlerrm not like 'BAD_TRANSITION%' then raise; end if;
  end;

  -- 6. Shipping the order ships what is left, with the courier on it.
  perform advance_order(o1, 'shipped', 'Delhivery', 'T123');
  select * into r from order_lines where id = 9000000011;
  assert r.status = 'shipped', 'SELFTEST FAILED: the item should be shipped, is ' || r.status;
  assert r.shipment->>'courier' = 'Delhivery', 'SELFTEST FAILED: the item lost its courier';
  select status into r from order_lines where id = 9000000012;
  assert r.status = 'cancelled', 'SELFTEST FAILED: shipping the order moved a cancelled item';

  -- 7. An item shipped on its own: the order stays packed, cannot be
  --    cancelled whole, and once the other item is cancelled it rises
  --    to shipped -- writing every step it passed.
  perform advance_order(o2, 'confirmed');
  perform advance_order(o2, 'packed');
  perform advance_line(9000000021, 'shipped');
  select status into r from orders where id = o2;
  assert r.status = 'packed', 'SELFTEST FAILED: one item shipped moved the order to ' || r.status;
  begin
    perform advance_order(o2, 'cancelled');
    raise exception 'SELFTEST FAILED: an order with a shipped item was cancelled whole';
  exception when others then
    if sqlerrm <> 'SOME_ITEMS_SHIPPED' then raise; end if;
  end;
  perform advance_line(9000000022, 'cancelled');
  select * into r from orders where id = o2;
  assert r.status = 'shipped', 'SELFTEST FAILED: the order should be shipped, is ' || r.status;
  assert r.history @> '[{"to": "shipped"}]'::jsonb,
    'SELFTEST FAILED: the order history has no Shipped step';

  -- 8. Its only item cancelled, an order is cancelled.
  perform advance_line(9000000031, 'cancelled');
  select status into r from orders where id = o3;
  assert r.status = 'cancelled', 'SELFTEST FAILED: the order should be cancelled, is ' || r.status;

  -- 9. A new order the shop declines is cancelled (not "abandoned"), and
  --    if it was paid, all of it is owed back.
  perform set_paid(o4, true, 'self test');
  perform advance_order(o4, 'cancelled');
  select status into r from order_lines where id = 9000000041;
  assert r.status = 'cancelled', 'SELFTEST FAILED: cancelling the order left its item ' || r.status;
  n := mark_refund(o4);
  assert n = 500, 'SELFTEST FAILED: the whole 500 should be owed back, not ' || n;

  raise exception 'ALL GOOD -- every check passed, and nothing was saved';
end $test$;
