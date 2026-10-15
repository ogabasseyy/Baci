DO $$ DECLARE r record; first_id uuid; remaining integer; BEGIN
 SELECT * INTO r FROM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":10,"quantity":2}]',p_expected_total=>20,p_checkout_idempotency_key=>'condition-order',p_checkout_request_hash=>'condition-v1');
 IF r.subtotal<>20 OR r.total<>20 THEN RAISE EXCEPTION 'used offer price was not authoritative: %',row_to_json(r); END IF;
 first_id:=r.id;
 IF (SELECT price FROM order_items WHERE order_id=r.id)<>10 OR (SELECT condition FROM order_items WHERE order_id=r.id)<>'used' THEN RAISE EXCEPTION 'order item lost selected condition price'; END IF;
 IF (SELECT stock_quantity FROM product_offers LIMIT 1)<>1 OR (SELECT stock_quantity FROM products LIMIT 1)<>20 THEN RAISE EXCEPTION 'condition stock decremented wrong pool'; END IF;
 SELECT * INTO r FROM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":10,"quantity":2}]',p_expected_total=>20,p_checkout_idempotency_key=>'condition-order',p_checkout_request_hash=>'condition-v1');
 IF r.id<>first_id OR NOT r.idempotency_replayed OR (SELECT stock_quantity FROM product_offers LIMIT 1)<>1 THEN RAISE EXCEPTION 'idempotent condition order consumed inventory twice'; END IF;
 BEGIN
  PERFORM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":10,"quantity":2}]');
  RAISE EXCEPTION 'test expected insufficient_condition_offer_stock';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'insufficient_condition_offer_stock' THEN RAISE; END IF; END;
 UPDATE product_offers SET price=11;
 BEGIN
  PERFORM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":10,"quantity":1}]');
  RAISE EXCEPTION 'test expected condition_offer_price_changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'condition_offer_price_changed' THEN RAISE; END IF; END;
 UPDATE product_offers SET status='inactive';
 BEGIN
  PERFORM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":11,"quantity":1}]');
  RAISE EXCEPTION 'test expected invalid_condition_offer';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_condition_offer' THEN RAISE; END IF; END;
 UPDATE product_offers SET status='active';
 BEGIN
  PERFORM private.create_storefront_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":11,"quantity":1}]');
  RAISE EXCEPTION 'test expected invalid_items';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_items' THEN RAISE; END IF; END;
 SELECT * INTO r FROM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"new","price":15,"quantity":1}]',p_expected_total=>15);
 IF r.total<>15 OR (SELECT stock_quantity FROM products LIMIT 1)<>19 THEN RAISE EXCEPTION 'base condition pricing/stock regressed'; END IF;
 IF (SELECT count(*) FROM orders)<>2 THEN RAISE EXCEPTION 'rejected condition orders left partial rows'; END IF;
END $$;
DO $$ DECLARE r record; before_count integer; BEGIN
 UPDATE product_offers SET price=100,stock_quantity=5;
 SELECT count(*) INTO before_count FROM orders;
 SELECT * INTO r FROM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":98,"quantity":1}]',p_discount_amount=>2,p_expected_total=>98);
 IF r.subtotal<>100 OR r.discount_amount<>2 OR r.total<>98 OR (SELECT stock_quantity FROM product_offers LIMIT 1)<>4 THEN RAISE EXCEPTION 'accepted condition negotiation changed financial basis'; END IF;
 BEGIN
  PERFORM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":97,"quantity":1}]',p_discount_amount=>3,p_expected_total=>97);
  RAISE EXCEPTION 'test expected condition_offer_price_changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'condition_offer_price_changed' THEN RAISE; END IF; END;
 UPDATE product_offers SET stock_quantity=1;
 BEGIN
  PERFORM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":100,"quantity":1},{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":100,"quantity":1}]');
  RAISE EXCEPTION 'test expected insufficient_condition_offer_stock';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'insufficient_condition_offer_stock' THEN RAISE; END IF; END;
 BEGIN
  PERFORM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"refurbished","price":100,"quantity":1}]');
  RAISE EXCEPTION 'test expected invalid_condition_offer';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_condition_offer' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM orders)<>before_count+1 THEN RAISE EXCEPTION 'rejected duplicate/floor condition orders persisted'; END IF;
 UPDATE merchants SET is_published=false;
 BEGIN
  PERFORM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":100,"quantity":1}]');
  RAISE EXCEPTION 'test expected invalid_condition_offer';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_condition_offer' THEN RAISE; END IF; END;
 UPDATE merchants SET is_published=true;
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.get_order_condition_prices('11111111-1111-4111-8111-111111111111',ARRAY['33333333-3333-4333-8333-333333333333']::uuid[]))<>1 THEN RAISE EXCEPTION 'public condition projection omitted eligible row'; END IF;
 IF EXISTS(SELECT 1 FROM public.get_order_condition_prices('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ARRAY['33333333-3333-4333-8333-333333333333']::uuid[])) THEN RAISE EXCEPTION 'projection crossed merchant'; END IF;
 UPDATE product_offers SET status='inactive';
 IF (SELECT status FROM public.get_order_condition_prices('11111111-1111-4111-8111-111111111111',ARRAY['33333333-3333-4333-8333-333333333333']::uuid[]) LIMIT 1)<>'inactive' THEN RAISE EXCEPTION 'projection hid inactive sentinel'; END IF;
END $$;
DO $$ DECLARE original_id uuid; item_id uuid; r jsonb; before_parent integer; current_order record; BEGIN
 SELECT oi.order_id,oi.id INTO original_id,item_id FROM order_items oi JOIN orders orders ON orders.id=oi.order_id WHERE orders.checkout_idempotency_key='condition-order';
 IF (SELECT product_offer_id FROM order_items WHERE id=item_id)<>'44444444-4444-4444-8444-444444444444' THEN RAISE EXCEPTION 'condition pool lineage missing'; END IF;
 SELECT stock_quantity INTO before_parent FROM products LIMIT 1;
 INSERT INTO private.uba_redvault_payment_attempts VALUES('55555555-5555-4555-8555-555555555555',original_id);
 INSERT INTO private.uba_redvault_refunds VALUES('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555','processed','merchandise_units');
 INSERT INTO private.uba_redvault_refund_line_allocations VALUES('66666666-6666-4666-8666-666666666666',item_id);
 UPDATE product_offers SET stock_quantity=1,status='active';
 r:=private.release_redvault_refund_quantity_units('66666666-6666-4666-8666-666666666666');
 IF (r->>'restockedCount')::integer<>1 OR (SELECT stock_quantity FROM product_offers LIMIT 1)<>2 OR (SELECT stock_quantity FROM products LIMIT 1)<>before_parent THEN RAISE EXCEPTION 'partial refund restored wrong inventory pool'; END IF;
 INSERT INTO private.uba_redvault_refund_lifecycle VALUES('66666666-6666-4666-8666-666666666666','released');
 PERFORM private.restock_order_items_excluding_redvault_releases(original_id);
 IF (SELECT stock_quantity FROM product_offers LIMIT 1)<>3 OR (SELECT stock_quantity FROM products LIMIT 1)<>before_parent THEN RAISE EXCEPTION 'cancellation repeated partial refund or restored parent'; END IF;
 SELECT * INTO current_order FROM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":100,"quantity":1}]');
 PERFORM private.restock_order_items_excluding_serialized(current_order.id);
 IF (SELECT stock_quantity FROM product_offers LIMIT 1)<>3 OR (SELECT stock_quantity FROM products LIMIT 1)<>before_parent THEN RAISE EXCEPTION 'serialized-excluding cancel restored wrong pool'; END IF;
 SELECT * INTO current_order FROM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":100,"quantity":1}]');
 PERFORM private.restock_order_items(current_order.id);
 IF (SELECT stock_quantity FROM product_offers LIMIT 1)<>3 OR (SELECT stock_quantity FROM products LIMIT 1)<>before_parent THEN RAISE EXCEPTION 'guest cancellation restored wrong pool'; END IF;
 BEGIN UPDATE order_items SET product_offer_id='44444444-4444-4444-8444-444444444444' WHERE condition='new'; RAISE EXCEPTION 'test expected order_item_condition_offer_mismatch'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'order_item_condition_offer_mismatch' THEN RAISE; END IF; END;
END $$;
DO $$ DECLARE r record; old_offer_stock integer; BEGIN
 UPDATE product_offers SET status='active',price=10;
 UPDATE merchants SET vat_registration_status='registered',vat_rate=7.5 WHERE id='11111111-1111-4111-8111-111111111111';
 SELECT * INTO r FROM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":10,"quantity":1}]',p_tax_amount=>0.75,p_expected_total=>10.75);
 IF r.subtotal<>10 OR r.tax_amount<>0.75 OR r.total<>10.75 THEN RAISE EXCEPTION 'VAT did not use condition catalog'; END IF;
 UPDATE merchants SET vat_registration_status='not_registered';
 SELECT stock_quantity INTO old_offer_stock FROM product_offers LIMIT 1;
 INSERT INTO product_variants(id,merchant_id,product_id,price_override,stock_quantity) VALUES('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',7,4);
 SELECT * INTO r FROM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","variant_id":"77777777-7777-4777-8777-777777777777","price":7,"quantity":1}]',p_expected_total=>7);
 IF r.total<>7 OR (SELECT stock_quantity FROM product_variants LIMIT 1)<>3 OR (SELECT stock_quantity FROM product_offers LIMIT 1)<>old_offer_stock THEN RAISE EXCEPTION 'variant pool/price parity regressed'; END IF;
 PERFORM private.restock_order_items(r.id);
 IF (SELECT stock_quantity FROM product_variants LIMIT 1)<>4 THEN RAISE EXCEPTION 'variant cancellation parity regressed'; END IF;
 INSERT INTO products(id,merchant_id,name,price,condition) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Foreign fixture',1,'used');
 INSERT INTO product_offers(id,merchant_id,product_id,condition,price,stock_quantity) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','used',1,1);
 BEGIN UPDATE order_items SET product_offer_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' WHERE order_id=r.id; RAISE EXCEPTION 'test expected order_item_condition_offer_mismatch'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'order_item_condition_offer_mismatch' THEN RAISE; END IF; END;
END $$;
DO $$ BEGIN
 BEGIN UPDATE product_offers SET merchant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' WHERE id='44444444-4444-4444-8444-444444444444'; RAISE EXCEPTION 'test expected ordered_product_offer_identity_immutable'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ordered_product_offer_identity_immutable' THEN RAISE; END IF; END;
 BEGIN UPDATE product_offers SET product_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' WHERE id='44444444-4444-4444-8444-444444444444'; RAISE EXCEPTION 'test expected ordered_product_offer_identity_immutable'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ordered_product_offer_identity_immutable' THEN RAISE; END IF; END;
 BEGIN UPDATE product_offers SET condition='open_box' WHERE id='44444444-4444-4444-8444-444444444444'; RAISE EXCEPTION 'test expected ordered_product_offer_identity_immutable'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ordered_product_offer_identity_immutable' THEN RAISE; END IF; END;
 UPDATE product_offers SET price=12,status='inactive' WHERE id='44444444-4444-4444-8444-444444444444';
 IF NOT EXISTS(SELECT 1 FROM product_offers WHERE id='44444444-4444-4444-8444-444444444444' AND price=12 AND status='inactive' AND condition='used' AND merchant_id='11111111-1111-4111-8111-111111111111') THEN RAISE EXCEPTION 'safe price/status edits blocked or identity changed'; END IF;
 -- Unreferenced offers may still change their identity under existing RLS.
 UPDATE product_offers SET condition='open_box' WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
END $$;
-- New orders use the same currency resolver as shared carts, while replay
-- keeps the order currency originally committed even after merchant changes.
DO $$ DECLARE r record; replay_id uuid; BEGIN
 UPDATE merchants SET payout_currency=' usd ',country=NULL,vat_registration_status='not_registered' WHERE id='11111111-1111-4111-8111-111111111111';
 SELECT * INTO r FROM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"new","price":15,"quantity":1}]',p_expected_total=>15,p_checkout_idempotency_key=>'currency-replay',p_checkout_request_hash=>'currency-v1');
 replay_id:=r.id;
 IF (SELECT currency FROM orders WHERE id=r.id)<>'USD' THEN RAISE EXCEPTION 'normalized payout currency changed'; END IF;
 UPDATE merchants SET payout_currency=NULL,country='United States' WHERE id='11111111-1111-4111-8111-111111111111';
 SELECT * INTO r FROM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"new","price":15,"quantity":1}]',p_expected_total=>15);
 IF (SELECT currency FROM orders WHERE id=r.id)<>'USD' THEN RAISE EXCEPTION 'order NULL payout ignored country fallback'; END IF;
 UPDATE merchants SET payout_currency='invalid-value',country='Côte d''Ivoire' WHERE id='11111111-1111-4111-8111-111111111111';
 SELECT * INTO r FROM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"new","price":15,"quantity":1}]',p_expected_total=>15);
 IF (SELECT currency FROM orders WHERE id=r.id)<>'XOF' THEN RAISE EXCEPTION 'order invalid payout ignored country fallback'; END IF;
 UPDATE merchants SET payout_currency='NGN',country='NG' WHERE id='11111111-1111-4111-8111-111111111111';
 SELECT * INTO r FROM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"new","price":15,"quantity":1}]',p_expected_total=>15,p_checkout_idempotency_key=>'currency-replay',p_checkout_request_hash=>'currency-v1');
 IF r.id<>replay_id OR NOT r.idempotency_replayed OR (SELECT currency FROM orders WHERE id=r.id)<>'USD' THEN RAISE EXCEPTION 'replay rewrote historical order currency'; END IF;
END $$;
-- Separate numeric condition pools have no mapping to serialized IMEI units.
-- A strict product must fail closed instead of bypassing unit allocation.
DO $$ DECLARE before_orders integer; before_offer integer; BEGIN
 IF EXISTS(SELECT 1 FROM public.variant_inventory) THEN RAISE EXCEPTION 'strict condition fixture unexpectedly has physical units'; END IF;
 UPDATE product_offers SET status='active',price=12,stock_quantity=5 WHERE id='44444444-4444-4444-8444-444444444444';
 UPDATE products SET inventory_tracking_policy='serialized_strict' WHERE id='33333333-3333-4333-8333-333333333333';
 SELECT count(*) INTO before_orders FROM orders;
 SELECT stock_quantity INTO before_offer FROM product_offers WHERE id='44444444-4444-4444-8444-444444444444';
 BEGIN PERFORM private.create_storefront_order('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture','[{"product_id":"33333333-3333-4333-8333-333333333333","condition":"used","price":12,"quantity":1}]'); RAISE EXCEPTION 'test expected invalid_condition_offer'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_condition_offer' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM orders)<>before_orders OR (SELECT stock_quantity FROM product_offers WHERE id='44444444-4444-4444-8444-444444444444')<>before_offer THEN RAISE EXCEPTION 'unsupported serialized condition created order or consumed aggregate stock'; END IF;
 IF EXISTS(SELECT 1 FROM public.get_order_condition_prices('11111111-1111-4111-8111-111111111111',ARRAY['33333333-3333-4333-8333-333333333333']::uuid[]) WHERE status='active' OR price IS NOT NULL) THEN RAISE EXCEPTION 'unsupported serialized condition exposed purchasable price'; END IF;
END $$;
