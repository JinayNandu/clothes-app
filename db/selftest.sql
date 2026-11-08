-- =====================================================================
--  Vastra Apparel -- a self-test of each item's status, cancelling one
--  item, refunds, going back a step, reviews, the catalogue (its prices,
--  its stock, and the checks every order now passes), disabling and
--  deleting a product, how its stock is kept, customers waiting for one,
--  and the emails -- run ON THE REAL DATABASE, and saving NOTHING. No
--  email leaves it either: a request made here is undone with the rest.
--
--  Paste the whole file into the Supabase SQL editor and run it, AFTER
--  schema.sql. It acts as the store -- the first phone let in with the
--  store code -- makes eight test orders and one test product of its
--  own, walks them through every rule below, and then undoes all of it
--  by ending in an error on purpose. The message you want begins:
--
--      ALL GOOD -- every check passed, and nothing was saved.
--
--  and goes on to say whether emails are ready (db/SETUP.md step 13).
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
  o5 uuid := gen_random_uuid();
  o6 uuid := gen_random_uuid();
  o7 uuid := gen_random_uuid();
  pj jsonb;
  base jsonb;
  o8 uuid := gen_random_uuid();
  cust uuid := (select id from auth.users where email is not null
                  and not coalesce(is_anonymous, false) order by created_at limit 1);
  em text;
  sent int;
  ms jsonb;
  mail_note text;
  rv bigint;
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
                 (o4, 9004,  500,  800, 0),
                 (o5, 9005, 2000, 3000, 0),
                 (o6, 9006, 1000, 1500, 0)) as o(id, seq, items, mrp, disc);

  insert into order_lines (id, order_id, pid, name, qty, unit_price, unit_mrp, line_total)
  values (9000000011, o1, 't1', 'Test shirt', 1, 1000, 1500, 1000),
         (9000000012, o1, 't2', 'Test dress', 1, 3000, 4000, 3000),
         (9000000021, o2, 't3', 'Test kurti', 1, 1000, 1500, 1000),
         (9000000022, o2, 't4', 'Test top',   1, 1000, 1500, 1000),
         (9000000031, o3, 't5', 'Test scarf', 1,  700, 1000,  700),
         (9000000041, o4, 't6', 'Test belt',  1,  500,  800,  500),
         (9000000051, o5, 't7', 'Test jacket', 1, 1000, 1500, 1000),
         (9000000052, o5, 't8', 'Test skirt',  1, 1000, 1500, 1000),
         (9000000061, o6, 't9', 'Test shawl',  1, 1000, 1500, 1000);

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
  begin
    perform step_back_order(o5, 'sent');
    raise exception 'SELFTEST FAILED: a stranger moved an order back';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;
  begin
    perform step_back_line(9000000051, 'sent');
    raise exception 'SELFTEST FAILED: a stranger moved an item back';
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

  -- 10. GOING BACK (8 November 2026). Delivered, then back to Shipped: the
  --     order and its items are shipped again, the delivery stamp is gone
  --     (no return window for a parcel that has not landed), the courier
  --     stays, and the history marks the step as a step back.
  perform advance_order(o5, 'confirmed');
  perform advance_order(o5, 'packed');
  perform advance_order(o5, 'shipped', 'Delhivery', 'T555');
  perform advance_order(o5, 'delivered');
  perform step_back_order(o5, 'shipped');
  select * into r from orders where id = o5;
  assert r.status = 'shipped', 'SELFTEST FAILED: back from delivered, the order is ' || r.status;
  assert r.delivered_at is null, 'SELFTEST FAILED: back from delivered, the delivery stamp stayed';
  assert r.shipment->>'courier' = 'Delhivery', 'SELFTEST FAILED: back to shipped, the courier went';
  assert r.history->-1 @> '{"to": "shipped", "back": true}'::jsonb,
    'SELFTEST FAILED: the step back is not marked as one in the history';
  select count(*) into n from order_lines where order_id = o5 and status = 'shipped';
  assert n = 2, 'SELFTEST FAILED: back to shipped moved ' || n || ' of 2 items';

  -- 11. Back again, to Packed: the courier is cleared from the order and
  --     from its items, which come back with it.
  perform step_back_order(o5, 'packed');
  select * into r from orders where id = o5;
  assert r.status = 'packed' and r.shipment is null,
    'SELFTEST FAILED: back to packed left ' || r.status || ' with a courier';
  select count(*) into n from order_lines
   where order_id = o5 and status = 'packed' and shipment is null;
  assert n = 2, 'SELFTEST FAILED: back to packed, ' || n || ' of 2 items are packed with no courier';

  -- 12. An item further along on its own stays there when the ORDER goes
  --     back -- the mirror of advance_order() -- and an item stepped back
  --     below the order takes the order down with it.
  perform advance_line(9000000051, 'shipped');
  perform step_back_order(o5, 'confirmed');
  select status into r from order_lines where id = 9000000051;
  assert r.status = 'shipped', 'SELFTEST FAILED: the order went back and took the shipped item to ' || r.status;
  select status into r from order_lines where id = 9000000052;
  assert r.status = 'confirmed', 'SELFTEST FAILED: the item at the order''s step went to ' || r.status;
  perform step_back_line(9000000052, 'sent');
  select * into r from orders where id = o5;
  assert r.status = 'sent', 'SELFTEST FAILED: an item back to Ordered left the order ' || r.status;
  assert r.history->-1 @> '{"to": "sent", "back": true}'::jsonb,
    'SELFTEST FAILED: the order followed its item down without a step back in its history';

  -- 13. Only BACK, and only along the road: not forward, not out of a
  --     cancellation, and not from a cancelled item.
  begin
    perform step_back_order(o5, 'packed');
    raise exception 'SELFTEST FAILED: step_back_order moved an order forward';
  exception when others then
    if sqlerrm not like 'BAD_STEP_BACK%' then raise; end if;
  end;
  begin
    perform step_back_order(o3, 'sent');
    raise exception 'SELFTEST FAILED: a cancelled order was brought back';
  exception when others then
    if sqlerrm not like 'BAD_STEP_BACK%' then raise; end if;
  end;
  begin
    perform step_back_line(9000000012, 'sent');
    raise exception 'SELFTEST FAILED: a cancelled item was brought back';
  exception when others then
    if sqlerrm not like 'BAD_STEP_BACK%' then raise; end if;
  end;

  -- 14. REVIEWS (8 November 2026). Only an item delivered, only by its
  --     customer, only 1 to 5 stars; sent twice, one review that changed;
  --     the public reads the stars, the words and "Self T.", never more;
  --     a hidden review leaves the shop and its average.
  perform advance_order(o6, 'confirmed');
  perform advance_order(o6, 'packed');
  perform advance_order(o6, 'shipped', 'Blue Dart', 'B66');
  begin
    perform submit_review(9000000061, 5, 'too soon');
    raise exception 'SELFTEST FAILED: an item not yet delivered was reviewed';
  exception when others then
    if sqlerrm <> 'NOT_DELIVERED' then raise; end if;
  end;
  begin
    perform rate_delivery(o6, 5, 'too soon');
    raise exception 'SELFTEST FAILED: a delivery was rated before it happened';
  exception when others then
    if sqlerrm <> 'NOT_DELIVERED' then raise; end if;
  end;
  perform advance_order(o6, 'delivered');
  begin
    perform submit_review(9000000061, 6, '');
    raise exception 'SELFTEST FAILED: six stars out of five were taken';
  exception when others then
    if sqlerrm <> 'BAD_RATING' then raise; end if;
  end;
  rv := submit_review(9000000061, 4, '  Soft cotton.  ');
  perform submit_review(9000000061, 5, 'Soft cotton, true to size.');
  select count(*) into n from reviews where line_id = 9000000061;
  assert n = 1, 'SELFTEST FAILED: a review sent twice made ' || n || ' reviews';
  select * into r from product_reviews('t9');
  assert r.rating = 5 and r.body = 'Soft cotton, true to size.' and r.author = 'Self T.',
    'SELFTEST FAILED: the shop reads ' || r.rating || ' stars, "' || r.body || '" by ' || r.author;
  select * into r from rating_summary() where pid = 't9';
  assert r.ratings = 1 and r.average = 5,
    'SELFTEST FAILED: the average reads ' || r.average || ' from ' || r.ratings;
  perform rate_delivery(o6, 3, 'A day late.');
  select * into r from delivery_ratings where order_id = o6;
  assert r.rating = 3 and r.courier = 'Blue Dart',
    'SELFTEST FAILED: the delivery rating reads ' || r.rating || ' for ' || r.courier;

  -- Somebody else may not review it, rate its delivery, or hide anything.
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(),
          'role', 'authenticated')::text, true);
  begin
    perform submit_review(9000000061, 1, 'not mine');
    raise exception 'SELFTEST FAILED: a stranger reviewed somebody else''s item';
  exception when others then
    if sqlerrm <> 'NOT_YOURS' then raise; end if;
  end;
  begin
    perform rate_delivery(o6, 1, 'not mine');
    raise exception 'SELFTEST FAILED: a stranger rated somebody else''s delivery';
  exception when others then
    if sqlerrm <> 'NOT_YOURS' then raise; end if;
  end;
  begin
    perform hide_review(rv, true);
    raise exception 'SELFTEST FAILED: a stranger hid a review';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', boss::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', boss,
          'role', 'authenticated')::text, true);

  perform hide_review(rv, true);
  select count(*) into n from product_reviews('t9');
  assert n = 0, 'SELFTEST FAILED: a hidden review is still in the shop';
  select count(*) into n from rating_summary() where pid = 't9';
  assert n = 0, 'SELFTEST FAILED: a hidden review still counts in the average';

  -- 15. THE CATALOGUE (8 November 2026). First, that the photographs
  --     have somewhere to go: schema.sql sets the bucket and its rule up
  --     in a block that only warns if Supabase refuses it.
  if not exists (select 1 from storage.buckets where id = 'product-photos' and public) then
    raise exception 'SELFTEST FAILED: the photo bucket product-photos is missing -- schema.sql printed why (PHOTO STORAGE NOT SET UP)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'product_photos_add') then
    raise exception 'SELFTEST FAILED: nothing lets the store add a photograph -- schema.sql printed why (PHOTO STORAGE NOT SET UP)';
  end if;

  --     A stranger may change nothing.
  --     The store adds a product, prices it, counts its stock and hides
  --     it -- and every order is checked against all of it, through
  --     take_lines(), which is what place_order() calls for its lines.
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(),
          'role', 'authenticated')::text, true);
  begin
    perform store_products();
    raise exception 'SELFTEST FAILED: a stranger read the store''s products';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;
  begin
    perform save_product('{"name": "x", "slug": "x"}'::jsonb);
    raise exception 'SELFTEST FAILED: a stranger added a product';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;
  begin
    perform set_price('p-anything', 1, 1);
    raise exception 'SELFTEST FAILED: a stranger changed a price';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;
  begin
    perform set_stock('p-anything', '{}'::jsonb);
    raise exception 'SELFTEST FAILED: a stranger changed the stock';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;
  begin
    perform set_status('p-anything', 'hidden');
    raise exception 'SELFTEST FAILED: a stranger hid a product';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', boss::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', boss,
          'role', 'authenticated')::text, true);

  -- A new product: blue only, in M and XL (XL 50 more), 12 and 1 in stock.
  base := jsonb_build_object(
    'name', 'Self Test Shirt', 'slug', 'selftest-shirt', 'cat', 'men', 'sub', 'men-shirts',
    'price', 1000, 'mrp', 1500, 'shortDesc', 'A test.', 'desc', 'A test shirt.',
    'specs', jsonb_build_array(jsonb_build_object('k', 'Fit', 'v', 'Test')),
    'img', jsonb_build_array('img/products/men-camp-shirt-sage-1.jpg'),
    'variants', jsonb_build_object(
      'colour', jsonb_build_array(jsonb_build_object('id', 'blue', 'label', 'Blue',
                                                     'swatch', '#223344', 'img', 0)),
      'size', jsonb_build_array(jsonb_build_object('id', 'm', 'label', 'M', 'delta', 0),
                                jsonb_build_object('id', 'xl', 'label', 'XL', 'delta', 50))),
    'skus', jsonb_build_object('blue/m', 12, 'blue/xl', 1), 'stockMode', 'counted');
  pj := save_product(base);
  assert pj->>'id' = 'p-selftest-shirt', 'SELFTEST FAILED: the new product is ' || coalesce(pj->>'id', 'missing');
  assert (pj->'skus'->>'blue/m')::int = 12, 'SELFTEST FAILED: a new product did not take its stock';
  -- Everybody sees it, and its stock only up to 10.
  select x into pj from jsonb_array_elements(catalogue()) as t(x) where x->>'id' = 'p-selftest-shirt';
  assert pj is not null, 'SELFTEST FAILED: a new product is not in the shop';
  assert (pj->'skus'->>'blue/m')::int = 10,
    'SELFTEST FAILED: the shop shows ' || (pj->'skus'->>'blue/m') || ' in stock, not 10';
  assert not (pj ? 'hidden'), 'SELFTEST FAILED: the shop is told what is hidden';

  -- What the store may not save.
  begin
    perform save_product(base || '{"slug": "selftest-two", "price": 1600}'::jsonb);
    raise exception 'SELFTEST FAILED: a price above the MRP was saved';
  exception when others then
    if sqlerrm <> 'BAD_MRP' then raise; end if;
  end;
  begin
    perform save_product(jsonb_set(base, '{variants,colour,0,swatch}', '"red"') || '{"slug": "selftest-two"}');
    raise exception 'SELFTEST FAILED: a swatch that is not a colour was saved';
  exception when others then
    if sqlerrm <> 'BAD_COLOUR' then raise; end if;
  end;
  begin
    perform save_product(jsonb_set(base, '{variants,colour,0,delta}', '50') || '{"slug": "selftest-two"}');
    raise exception 'SELFTEST FAILED: a colour that moves the price was saved';
  exception when others then
    if sqlerrm <> 'BAD_COLOUR' then raise; end if;
  end;
  begin
    perform save_product(base || '{"slug": "selftest-two", "img": ["https://example.com/x.jpg"]}'::jsonb);
    raise exception 'SELFTEST FAILED: a photograph from somebody else''s site was saved';
  exception when others then
    if sqlerrm <> 'BAD_PHOTOS' then raise; end if;
  end;
  begin
    perform save_product(jsonb_set(base, '{variants,colour,0,img}', 'null')
                         || '{"slug": "selftest-two", "img": []}'::jsonb);
    raise exception 'SELFTEST FAILED: a product with no photograph went on show';
  exception when others then
    if sqlerrm <> 'NEEDS_A_PHOTO' then raise; end if;
  end;
  begin
    perform save_product(base);
    raise exception 'SELFTEST FAILED: two products were given one link';
  exception when others then
    if sqlerrm <> 'SLUG_TAKEN' then raise; end if;
  end;

  -- The price, alone; never above the MRP.
  pj := set_price('p-selftest-shirt', 1100, 1500);
  assert (pj->>'price')::int = 1100, 'SELFTEST FAILED: the price did not change';
  begin
    perform set_price('p-selftest-shirt', 1600, 1500);
    raise exception 'SELFTEST FAILED: set_price put a price above the MRP';
  exception when others then
    if sqlerrm <> 'BAD_MRP' then raise; end if;
  end;

  -- Stock, by the difference: the page showed 12, the owner typed 15, and
  -- one was sold meanwhile -- 14, not 15.
  update products set skus = jsonb_set(skus, '{blue/m}', '11') where id = 'p-selftest-shirt';
  pj := set_stock('p-selftest-shirt', '{"blue/m": [12, 15]}'::jsonb);
  assert (pj->'skus'->>'blue/m')::int = 14,
    'SELFTEST FAILED: the stock should be 14 (11 + 15 - 12), is ' || (pj->'skus'->>'blue/m');
  begin
    perform set_stock('p-selftest-shirt', '{"red/m": [0, 5]}'::jsonb);
    raise exception 'SELFTEST FAILED: stock was set for a colour the product does not have';
  exception when others then
    if sqlerrm <> 'BAD_STOCK' then raise; end if;
  end;
  begin
    perform set_stock('p-selftest-shirt', '{"blue/m": [14, -1]}'::jsonb);
    raise exception 'SELFTEST FAILED: the stock was set below nothing';
  exception when others then
    if sqlerrm <> 'BAD_STOCK' then raise; end if;
  end;

  -- Saving the product again keeps the stock the database has -- an order
  -- may have taken some -- and a size added takes what it is given.
  pj := save_product(jsonb_set(base, '{variants,size}', '[{"id": "m", "label": "M", "delta": 0},
          {"id": "l", "label": "L", "delta": 0}, {"id": "xl", "label": "XL", "delta": 50}]')
        || '{"id": "p-selftest-shirt", "name": "Self Test Shirt Two", "price": 1100,
             "skus": {"blue/m": 99, "blue/l": 5, "blue/xl": 99}}'::jsonb);
  assert pj->>'name' = 'Self Test Shirt Two', 'SELFTEST FAILED: the product was not changed';
  assert (pj->'skus'->>'blue/m')::int = 14 and (pj->'skus'->>'blue/xl')::int = 1,
    'SELFTEST FAILED: saving the product wrote its stock over: ' || (pj->>'skus');
  assert (pj->'skus'->>'blue/l')::int = 5, 'SELFTEST FAILED: a new size did not take its stock';

  -- The order's checks. The right price takes the stock off.
  perform take_lines('[{"pid": "p-selftest-shirt", "variant": {"colour": "blue", "size": "m"},
                        "qty": 2, "unitPrice": 1100, "unitMrp": 1500}]'::jsonb);
  select (skus->>'blue/m')::int into n from products where id = 'p-selftest-shirt';
  assert n = 12, 'SELFTEST FAILED: an order of 2 left ' || n || ' of 14';
  -- XL is 50 more, so the M price for it is refused.
  begin
    perform take_lines('[{"pid": "p-selftest-shirt", "variant": {"colour": "blue", "size": "xl"},
                          "qty": 1, "unitPrice": 1100, "unitMrp": 1500}]'::jsonb);
    raise exception 'SELFTEST FAILED: an XL was sold at the price of an M';
  exception when others then
    if sqlerrm <> 'PRICE_CHANGED p-selftest-shirt' then raise; end if;
  end;
  -- Two XL with one left is refused, saying how many there are -- and a
  -- refused order takes nothing, not even its first line.
  begin
    perform take_lines('[{"pid": "p-selftest-shirt", "variant": {"colour": "blue", "size": "m"},
                          "qty": 1, "unitPrice": 1100, "unitMrp": 1500},
                         {"pid": "p-selftest-shirt", "variant": {"colour": "blue", "size": "xl"},
                          "qty": 2, "unitPrice": 1150, "unitMrp": 1550}]'::jsonb);
    raise exception 'SELFTEST FAILED: two were sold when one was left';
  exception when others then
    if sqlerrm <> 'OUT_OF_STOCK p-selftest-shirt blue/xl 1' then raise; end if;
  end;
  select (skus->>'blue/m')::int into n from products where id = 'p-selftest-shirt';
  assert n = 12, 'SELFTEST FAILED: a refused order still took stock (' || n || ' left of 12)';
  -- A size it does not sell, and a colour left out.
  begin
    perform take_lines('[{"pid": "p-selftest-shirt", "variant": {"colour": "blue", "size": "s"},
                          "qty": 1, "unitPrice": 1100, "unitMrp": 1500}]'::jsonb);
    raise exception 'SELFTEST FAILED: a size the product does not have was sold';
  exception when others then
    if sqlerrm <> 'BAD_LINE' then raise; end if;
  end;
  begin
    perform take_lines('[{"pid": "p-selftest-shirt", "variant": {"size": "m"},
                          "qty": 1, "unitPrice": 1100, "unitMrp": 1500}]'::jsonb);
    raise exception 'SELFTEST FAILED: an order line with no colour was sold';
  exception when others then
    if sqlerrm <> 'BAD_LINE' then raise; end if;
  end;

  -- A cancelled item puts its stock back, once; so does a cancelled order.
  insert into orders (id, seq, user_id, status, cust_name, cust_mobile, addr, city, state, pin,
                      items_total, mrp_total, saved, discount, discount_placed, shipping, bulky,
                      grand, pay_method, arrives_from, arrives_to, history)
  values (o7, 9007, boss, 'sent', 'Self Test', '9000000000', '1 Test Street, Nowhere',
          'Bengaluru', 'Karnataka', '560001', 3350, 4550, 1200, 0, 0, 0, 0, 3350, 'upi',
          today + 5, today + 10, jsonb_build_array(jsonb_build_object('at', iso_now(), 'to', 'sent')));
  insert into order_lines (id, order_id, pid, name, variant, qty, unit_price, unit_mrp, line_total,
                           checked, stock_taken)
  values (9000000071, o7, 'p-selftest-shirt', 'Self Test Shirt', '{"colour": "blue", "size": "m"}',
          2, 1100, 1500, 2200, true, true),
         (9000000072, o7, 'p-selftest-shirt', 'Self Test Shirt', '{"colour": "blue", "size": "xl"}',
          1, 1150, 1550, 1150, true, true);
  perform advance_line(9000000071, 'cancelled');
  select (skus->>'blue/m')::int into n from products where id = 'p-selftest-shirt';
  assert n = 14, 'SELFTEST FAILED: a cancelled item of 2 left the stock at ' || n || ', not 14';
  select count(*) into n from order_lines where id = 9000000071 and stock_taken;
  assert n = 0, 'SELFTEST FAILED: a cancelled item still says its stock is taken';
  perform advance_order(o7, 'cancelled');
  select * into r from products where id = 'p-selftest-shirt';
  assert (r.skus->>'blue/xl')::int = 2 and (r.skus->>'blue/m')::int = 14,
    'SELFTEST FAILED: cancelling the order put back ' || r.skus::text;

  -- Hidden: out of the shop and out of every order, still in the store.
  pj := set_status('p-selftest-shirt', 'hidden');
  select count(*) into n from jsonb_array_elements(catalogue()) as t(x) where x->>'id' = 'p-selftest-shirt';
  assert n = 0, 'SELFTEST FAILED: a hidden product is still in the shop';
  select count(*) into n from jsonb_array_elements(store_products()) as t(x) where x->>'id' = 'p-selftest-shirt';
  assert n = 1, 'SELFTEST FAILED: the store lost a hidden product';
  begin
    perform take_lines('[{"pid": "p-selftest-shirt", "variant": {"colour": "blue", "size": "m"},
                          "qty": 1, "unitPrice": 1100, "unitMrp": 1500}]'::jsonb);
    raise exception 'SELFTEST FAILED: a hidden product was sold';
  exception when others then
    if sqlerrm <> 'GONE_FROM_CATALOGUE p-selftest-shirt' then raise; end if;
  end;

  -- 16. DISABLED, DELETED, HOW STOCK IS KEPT, WAITING CUSTOMERS AND THE
  --     EMAILS (9 November 2026). A stranger may change none of it.
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(),
          'role', 'authenticated')::text, true);
  begin
    perform set_status('p-selftest-shirt', 'active');
    raise exception 'SELFTEST FAILED: a stranger put a product on sale';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;
  begin
    perform set_stock_mode('p-selftest-shirt', 'always');
    raise exception 'SELFTEST FAILED: a stranger changed how stock is kept';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;
  begin
    perform mail_status();
    raise exception 'SELFTEST FAILED: a stranger read how emails are set up';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;
  begin
    perform send_notices_now();
    raise exception 'SELFTEST FAILED: a stranger sent the waiting emails';
  exception when others then
    if sqlerrm <> 'NOT_STAFF' then raise; end if;
  end;
  -- Somebody with no proved email may not ask to be told: the shop must
  -- never email an address nobody proved.
  begin
    perform register_interest('p-selftest-shirt', null);
    raise exception 'SELFTEST FAILED: somebody with no email asked to be told';
  exception when others then
    if sqlerrm <> 'SIGN_IN_FIRST' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', boss::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', boss,
          'role', 'authenticated')::text, true);

  -- Always in stock: an order takes nothing off.
  pj := set_status('p-selftest-shirt', 'active');
  pj := set_stock_mode('p-selftest-shirt', 'always');
  assert pj->>'status' = 'active' and pj->>'stockMode' = 'always',
    'SELFTEST FAILED: the product reads ' || coalesce(pj->>'status', '?') || ', ' || coalesce(pj->>'stockMode', '?');
  perform take_lines('[{"pid": "p-selftest-shirt", "variant": {"colour": "blue", "size": "m"},
                        "qty": 3, "unitPrice": 1100, "unitMrp": 1500}]'::jsonb);
  select (skus->>'blue/m')::int into n from products where id = 'p-selftest-shirt';
  assert n = 14, 'SELFTEST FAILED: an order of a product always in stock took stock off (' || n || ' left of 14)';

  -- Out of stock, and disabled: in nobody's order, said as out of stock.
  pj := set_stock_mode('p-selftest-shirt', 'out');
  begin
    perform take_lines('[{"pid": "p-selftest-shirt", "variant": {"colour": "blue", "size": "m"},
                          "qty": 1, "unitPrice": 1100, "unitMrp": 1500}]'::jsonb);
    raise exception 'SELFTEST FAILED: a product marked out of stock was sold';
  exception when others then
    if sqlerrm <> 'OUT_OF_STOCK p-selftest-shirt blue/m 0' then raise; end if;
  end;
  pj := set_stock_mode('p-selftest-shirt', 'always');
  pj := set_status('p-selftest-shirt', 'disabled');
  select x into pj from jsonb_array_elements(catalogue()) as t(x) where x->>'id' = 'p-selftest-shirt';
  assert pj->>'status' = 'disabled',
    'SELFTEST FAILED: a disabled product is not in the shop marked so: ' || coalesce(pj->>'status', 'missing');
  begin
    perform take_lines('[{"pid": "p-selftest-shirt", "variant": {"colour": "blue", "size": "m"},
                          "qty": 1, "unitPrice": 1100, "unitMrp": 1500}]'::jsonb);
    raise exception 'SELFTEST FAILED: a disabled product was sold';
  exception when others then
    if sqlerrm <> 'OUT_OF_STOCK p-selftest-shirt blue/m 0' then raise; end if;
  end;

  -- Deleted: out of the shop and out of every order, kept in the store,
  -- and brought back.
  pj := set_status('p-selftest-shirt', 'deleted');
  select count(*) into n from jsonb_array_elements(catalogue()) as t(x) where x->>'id' = 'p-selftest-shirt';
  assert n = 0, 'SELFTEST FAILED: a deleted product is still in the shop';
  select x into pj from jsonb_array_elements(store_products()) as t(x) where x->>'id' = 'p-selftest-shirt';
  assert pj->>'status' = 'deleted',
    'SELFTEST FAILED: the store lost a deleted product, or calls it ' || coalesce(pj->>'status', 'missing');
  begin
    perform take_lines('[{"pid": "p-selftest-shirt", "variant": {"colour": "blue", "size": "m"},
                          "qty": 1, "unitPrice": 1100, "unitMrp": 1500}]'::jsonb);
    raise exception 'SELFTEST FAILED: a deleted product was sold';
  exception when others then
    if sqlerrm <> 'GONE_FROM_CATALOGUE p-selftest-shirt' then raise; end if;
  end;
  begin
    perform set_status('p-selftest-shirt', 'gone');
    raise exception 'SELFTEST FAILED: a status that does not exist was set';
  exception when others then
    if sqlerrm <> 'BAD_STATUS' then raise; end if;
  end;
  begin
    perform set_stock_mode('p-selftest-shirt', 'lots');
    raise exception 'SELFTEST FAILED: a way of keeping stock that does not exist was set';
  exception when others then
    if sqlerrm <> 'BAD_STOCK_MODE' then raise; end if;
  end;
  pj := set_status('p-selftest-shirt', 'active');
  assert pj->>'status' = 'active', 'SELFTEST FAILED: a deleted product did not come back';

  -- Waiting customers: told once they can buy what they asked for -- any
  -- of the product, or one colour in one size -- and once only. Needs a
  -- customer who has signed in with an email; the shop has had one.
  if cust is null then
    mail_note := ' (Waiting customers not tested: nobody has signed in with an email yet.)';
  else
    pj := set_stock_mode('p-selftest-shirt', 'counted');
    update products set skus = '{"blue/m": 0, "blue/l": 0, "blue/xl": 0}'::jsonb
     where id = 'p-selftest-shirt';
    perform set_config('request.jwt.claim.sub', cust::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', cust,
            'role', 'authenticated')::text, true);
    em := register_interest('p-selftest-shirt', null);
    assert em is not null, 'SELFTEST FAILED: asking to be told named no address';
    em := register_interest('p-selftest-shirt', 'blue/xl');
    em := register_interest('p-selftest-shirt', 'blue/xl');
    select count(*) into n from interest where user_id = cust and pid = 'p-selftest-shirt';
    assert n = 2, 'SELFTEST FAILED: asking for any size, then for XL twice, made ' || n || ' requests, not 2';
    begin
      perform register_interest('p-selftest-shirt', 'red/m');
      raise exception 'SELFTEST FAILED: a colour the product does not have was waited for';
    exception when others then
      if sqlerrm <> 'BAD_SKU' then raise; end if;
    end;
    select count(*) into n from interest where pid = 'p-selftest-shirt' and ready_at is not null;
    assert n = 0, 'SELFTEST FAILED: ' || n || ' waiting customers were told while nothing was in stock';
    perform set_config('request.jwt.claim.sub', boss::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', boss,
            'role', 'authenticated')::text, true);
    -- M comes in: the one waiting for any size is owed an email, the one
    -- waiting for XL is not.
    pj := set_stock('p-selftest-shirt', '{"blue/m": [0, 4]}'::jsonb);
    select count(*) into n from interest
     where pid = 'p-selftest-shirt' and sku is null and ready_at is not null;
    assert n = 1, 'SELFTEST FAILED: the customer waiting for any size was not told when M came in';
    select count(*) into n from interest
     where pid = 'p-selftest-shirt' and sku = 'blue/xl' and ready_at is not null;
    assert n = 0, 'SELFTEST FAILED: the customer waiting for XL was told when only M came in';
    pj := set_stock('p-selftest-shirt', '{"blue/xl": [0, 1]}'::jsonb);
    select count(*) into n from interest
     where pid = 'p-selftest-shirt' and sku = 'blue/xl' and ready_at is not null;
    assert n = 1, 'SELFTEST FAILED: the customer waiting for XL was not told when XL came in';
    select x into pj from jsonb_array_elements(store_products()) as t(x) where x->>'id' = 'p-selftest-shirt';
    assert (pj->>'waiting')::int = 2,
      'SELFTEST FAILED: the store sees ' || coalesce(pj->>'waiting', 'none') || ' waiting, not 2';
    pj := interest_mail((select id from interest where user_id = cust and pid = 'p-selftest-shirt'
                           and sku = 'blue/xl'), 'Test Shop');
    assert pj->>'subject' = 'Self Test Shirt Two in Blue · XL is back',
      'SELFTEST FAILED: the email to a waiting customer says ' || coalesce(pj->>'subject', 'nothing');
    perform set_config('request.jwt.claim.sub', cust::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', cust,
            'role', 'authenticated')::text, true);
    perform drop_interest('p-selftest-shirt', 'blue/xl');
    select count(*) into n from interest where user_id = cust and pid = 'p-selftest-shirt';
    assert n = 1, 'SELFTEST FAILED: "don''t tell me" left ' || n || ' requests, not 1';
    perform set_config('request.jwt.claim.sub', boss::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', boss,
            'role', 'authenticated')::text, true);
  end if;

  -- An order's news: a change owes its customer an email, two minutes on;
  -- the email says where it is now, and anything they typed is text.
  -- ⚠️ The order carries its own address. It is the store phone's order,
  -- and a store phone signs in with no email, so without one send_notices()
  -- would find nobody to write to and the count below would be 0 (the
  -- owner's first run of this, 9 November 2026). The address is on a
  -- domain that cannot exist, and no email leaves this test anyway.
  insert into orders (id, seq, user_id, status, cust_name, cust_mobile, cust_email, addr, city,
                      state, pin, items_total, mrp_total, saved, discount, discount_placed,
                      shipping, bulky, grand, pay_method, arrives_from, arrives_to, history)
  values (o8, 9008, boss, 'sent', '<b>Self</b> & Test', '9000000000', 'selftest@example.invalid',
          '1 Test Street, Nowhere',
          'Bengaluru', 'Karnataka', '560001', 1000, 1500, 500, 0, 0, 0, 0, 1000, 'upi',
          today + 5, today + 10, jsonb_build_array(jsonb_build_object('at', iso_now(), 'to', 'sent')));
  insert into order_lines (id, order_id, pid, name, qty, unit_price, unit_mrp, line_total)
  values (9000000081, o8, 't10', 'Test <i>scarf</i>', 1, 1000, 1500, 1000);
  perform advance_order(o8, 'confirmed');
  select * into r from orders where id = o8;
  assert r.notify_after > now(), 'SELFTEST FAILED: confirming an order owed its customer no email';
  pj := order_mail(o8, 'Test Shop');
  assert pj->>'subject' = 'Your order is confirmed (VA-9008)',
    'SELFTEST FAILED: the order email says ' || coalesce(pj->>'subject', 'nothing');
  assert position('&lt;b&gt;Self&lt;/b&gt;' in pj->>'html') > 0 and position('<b>Self' in pj->>'html') = 0,
    'SELFTEST FAILED: a name typed with markup went into the email as markup';
  assert position('Test &lt;i&gt;scarf&lt;/i&gt;' in pj->>'html') > 0,
    'SELFTEST FAILED: an item''s name went into the email as markup';

  -- Sent when due -- if the shop has its key. The request is undone with
  -- everything else here, so no email leaves this test.
  ms := mail_status();
  update orders set notify_after = now() - interval '1 second' where id = o8;
  begin
    sent := send_notices();
    if (ms->>'key')::boolean then
      select * into r from orders where id = o8;
      assert r.notify_after is null and r.notified_state = order_state(o8),
        'SELFTEST FAILED: an owed email was not marked sent';
      select count(*) into n from notices where order_id = o8;
      assert n = 1, 'SELFTEST FAILED: ' || n || ' emails for one change, not 1';
      update orders set notify_after = now() - interval '1 second' where id = o8;
      perform send_notices();
      select count(*) into n from notices where order_id = o8;
      assert n = 1, 'SELFTEST FAILED: an email went again with nothing new to say';
    else
      assert sent = 0, 'SELFTEST FAILED: emails went out with no key';
      select * into r from orders where id = o8;
      assert r.notify_after is not null,
        'SELFTEST FAILED: with no key, the owed email was dropped instead of kept';
    end if;
  exception when assert_failure then
    raise;
  when others then
    mail_note := coalesce(mail_note, '') || ' (Emails could not be sent: ' || sqlerrm || '.)';
  end;

  mail_note := coalesce(mail_note, '') || case
    when not (ms->>'key')::boolean then ' Emails: not set up yet (db/SETUP.md step 13).'
    when not (ms->>'net')::boolean then ' Emails: the key is in, but pg_net is off (db/SETUP.md step 13).'
    when not (ms->>'cron')::boolean then ' Emails: ready, sent while the store page is open -- the every-minute job is not set up.'
    else ' Emails: ready.' end;
  raise exception 'ALL GOOD -- every check passed, and nothing was saved.%', mail_note;
end $test$;
