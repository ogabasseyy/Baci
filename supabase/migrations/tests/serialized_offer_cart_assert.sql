DO $$ DECLARE snapshot jsonb; line jsonb; BEGIN
 snapshot := public.commerce_cart_build_checkout_snapshot('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000031');
 line := snapshot->'lines'->0;
 IF (line->>'available')::boolean IS DISTINCT FROM false OR (line->>'stockQty')::integer IS DISTINCT FROM 2 THEN
  RAISE EXCEPTION 'cart must use the selected offer unit count, got %', line;
 END IF;
END $$;
UPDATE public.products SET manage_stock=false WHERE id='00000000-0000-0000-0000-000000000001';
DO $$ DECLARE line jsonb; BEGIN
 line := public.commerce_cart_build_checkout_snapshot('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000031')->'lines'->0;
 IF (line->>'available')::boolean IS DISTINCT FROM false OR (line->>'manageStock')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'strict offer must enforce serialized stock even when parent stock management is disabled';
 END IF;
END $$;
UPDATE public.commerce_cart_lines SET quantity=2 WHERE id='00000000-0000-0000-0000-000000000032';
DO $$ DECLARE line jsonb; BEGIN
 line := public.commerce_cart_build_checkout_snapshot('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000031')->'lines'->0;
 IF (line->>'available')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'matching units must be purchasable'; END IF;
END $$;
INSERT INTO public.commerce_cart_lines VALUES ('00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000031',now(),'00000000-0000-0000-0000-000000000001',NULL,'used','{}',1,NULL,NULL,NULL,NULL,false,0,8000);
DO $$ DECLARE snapshot jsonb; BEGIN
 snapshot := public.commerce_cart_build_checkout_snapshot('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000031');
 IF (snapshot->'estimates'->>'unavailableCount')::integer IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'same-offer pooled demand must count both lines'; END IF;
END $$;
-- A null scalar on serialized-then-unlimited is genuinely unbounded, not zero.
UPDATE public.products SET inventory_tracking_policy='serialized_then_unlimited' WHERE id='00000000-0000-0000-0000-000000000001';
UPDATE public.product_offers SET stock_quantity=NULL WHERE id='00000000-0000-0000-0000-000000000003';
DO $$ DECLARE line jsonb; BEGIN
 line := public.commerce_cart_build_checkout_snapshot('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000031')->'lines'->0;
 IF (line->>'available')::boolean IS DISTINCT FROM true OR (line->>'manageStock')::boolean IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'unbounded serialized offer must remain available, got %', line;
 END IF;
END $$;
UPDATE public.product_offers SET stock_quantity=1 WHERE id='00000000-0000-0000-0000-000000000003';
DO $$ DECLARE line jsonb; BEGIN
 line := public.commerce_cart_build_checkout_snapshot('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000031')->'lines'->0;
 IF (line->>'available')::boolean IS DISTINCT FROM false OR (line->>'manageStock')::boolean IS DISTINCT FROM true OR (line->>'stockQty')::integer <> 1 THEN
  RAISE EXCEPTION 'finite unlimited-policy offer must enforce its scalar cap, got %', line;
 END IF;
END $$;
UPDATE public.merchants SET is_published=false WHERE id='00000000-0000-0000-0000-000000000010';
DO $$ DECLARE line jsonb; BEGIN
 line := public.commerce_cart_build_checkout_snapshot('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000031')->'lines'->0;
 IF (line->>'available')::boolean IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'missing authority result must fail closed, got %', line;
 END IF;
END $$;
