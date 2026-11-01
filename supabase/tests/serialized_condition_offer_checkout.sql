-- Full-schema replay contract. No production data is used; the transaction
-- rolls back. A condition offer must claim the corresponding serialized unit.
\set VERBOSITY verbose
BEGIN;
-- Bound the synthetic checkout statement so a stuck query reports its fixture
-- phase instead of exhausting the disposable replay database's resources.
SET LOCAL statement_timeout = '15s';

-- Open only the checkout eligibility gate inside this transaction. The order
-- routing and protocol marker must come from the production migrations.
CREATE OR REPLACE FUNCTION public.commerce_cart_condition_pool_is_quantity_managed(p_merchant_id uuid,p_product_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN public.get_effective_inventory_tracking_policy(
     coalesce(to_jsonb(product)->>'inventory_tracking_policy','off'), anchor.inventory_tracking_policy
   ) IN ('serialized_strict','serialized_then_unlimited')
   THEN product.has_variants IS DISTINCT FROM TRUE AND coalesce(product.variant_model,'legacy') <> 'sku_matrix'
   ELSE true END
 FROM public.products product LEFT JOIN public.product_variants anchor
  ON anchor.id=nullif(to_jsonb(product)->>'inventory_anchor_variant_id','')::uuid
  AND anchor.product_id=product.id AND anchor.merchant_id=product.merchant_id
 WHERE product.id=p_product_id AND product.merchant_id=p_merchant_id;
$$;
-- Only trusted order creation may write this marker. Inspect it through a
-- test-only privileged helper because production roles have no table access.
CREATE FUNCTION pg_temp.has_serialized_offer_marker(p_item uuid, p_merchant uuid, p_offer uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM private.serialized_offer_order_items
    WHERE order_item_id=p_item AND merchant_id=p_merchant AND offer_id=p_offer);
$$;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('test.serialized_offer_failure_phase','0',true);
SELECT set_config('test.serialized_offer_outer_error','00000',true);
-- Catch failures outside the inner handler (including block compilation) and
-- expose only a synthetic SQLSTATE category through distinct assertion lines.
DO $diagnostic$
BEGIN
EXECUTE $fixture$
DO $$
DECLARE
  merchant uuid := '37440000-0000-4000-8000-000000000001';
  product uuid := '37440000-0000-4000-8000-000000000002';
  used_offer uuid := '37440000-0000-4000-8000-000000000003';
  new_offer uuid := '37440000-0000-4000-8000-000000000004';
  used_unit uuid;
  new_unit uuid;
  v_order_id uuid;
  restocked jsonb;
  before_orders bigint;
  before_stock integer;
  n integer;
  shortage boolean := false;
  phase integer := 1;
BEGIN
  INSERT INTO public.merchants(id,email,business_name,slug,is_published)
  VALUES (merchant,'serialized-offer-fixture@example.com','Serialized offer fixture','serialized-offer-fixture',true);
  INSERT INTO public.products(id,merchant_id,name,price,status,stock_quantity,manage_stock,has_condition_offers,has_variants,inventory_tracking_policy)
  VALUES (product,merchant,'Serialized offer fixture',100,'active',0,true,true,false,'serialized_strict');
  INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity,status)
  VALUES (used_offer,product,merchant,'used',80,3,'active'),(new_offer,product,merchant,'new',100,3,'active');
  restocked := public.restock_variant_inventory_units(merchant,product,
    '[{"serial":"serialized-offer-used-3744"},{"serial":"serialized-offer-new-3744"}]'::jsonb);
  used_unit := (restocked->'unitIds'->>0)::uuid;
  new_unit := (restocked->'unitIds'->>1)::uuid;
  PERFORM public.assign_variant_inventory_unit_offer(merchant,used_unit,used_offer);
  PERFORM public.assign_variant_inventory_unit_offer(merchant,new_unit,new_offer);

  phase := 2;
  SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution(merchant,ARRAY[product]) WHERE offer_id=used_offer;
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'used offer must expose its one assigned unit'; END IF;
  phase := 3;
  SELECT (entry->>'allocatable_stock')::integer INTO n
  FROM private.get_storefront_pdp_core_v2(merchant, product::text, NULL) AS pdp,
    LATERAL jsonb_array_elements(pdp.product_data->'product_offers') AS entry
  WHERE entry->>'id' = used_offer::text;
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'PDP must expose assigned offer stock when ordinary pool is empty'; END IF;
  phase := 4;
  SELECT count(*) INTO before_orders FROM public.orders WHERE merchant_id=merchant;
  SELECT stock_quantity INTO before_stock FROM public.product_offers WHERE id=used_offer;
  BEGIN
    PERFORM * FROM public.create_storefront_order(
      p_merchant_id => merchant, p_customer_email => 'serialized-offer-buyer@example.com',
      p_customer_name => 'Serialized offer buyer', p_items => jsonb_build_array(jsonb_build_object(
        'product_id',product,'offer_id',used_offer,'condition','used','quantity',2))
    );
  EXCEPTION WHEN object_not_in_prerequisite_state THEN shortage := true;
  END;
  IF NOT shortage THEN RAISE EXCEPTION 'strict offer shortage was accepted'; END IF;
  IF (SELECT count(*) FROM public.orders WHERE merchant_id=merchant) <> before_orders
    OR (SELECT stock_quantity FROM public.product_offers WHERE id=used_offer) <> before_stock
    OR EXISTS (SELECT 1 FROM public.variant_inventory WHERE id IN (used_unit,new_unit) AND status <> 'available') THEN
    RAISE EXCEPTION 'shortage must roll back the order, scalar stock and unit reservations';
  END IF;

  phase := 5;
  SELECT o.id INTO v_order_id FROM public.create_storefront_order(
    p_merchant_id => merchant, p_customer_email => 'serialized-offer-buyer@example.com',
    p_customer_name => 'Serialized offer buyer', p_items => jsonb_build_array(jsonb_build_object(
      'product_id',product,'offer_id',used_offer,'condition','used','quantity',1))
  ) o;
  phase := 6;
  IF NOT EXISTS (SELECT 1 FROM public.variant_inventory vi JOIN public.order_items oi ON oi.id=vi.order_item_id
    WHERE vi.id=used_unit AND vi.order_id=v_order_id AND vi.status='reserved' AND oi.product_offer_id=used_offer)
    OR EXISTS (SELECT 1 FROM public.variant_inventory WHERE id=new_unit AND status <> 'available') THEN
    RAISE EXCEPTION 'order must reserve only the matching condition unit';
  END IF;
  phase := 7;
  IF NOT pg_temp.has_serialized_offer_marker(
    (SELECT id FROM public.order_items WHERE order_id=v_order_id AND product_offer_id=used_offer),
    merchant, used_offer
  ) THEN
    RAISE EXCEPTION 'trusted order creation did not record the serialized offer marker';
  END IF;
  phase := 8;
  IF (SELECT stock_quantity FROM public.product_offers WHERE id=used_offer) <> before_stock - 1 THEN
    RAISE EXCEPTION 'successful order must decrement the matching offer scalar';
  END IF;
  SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution(merchant,ARRAY[product]) WHERE offer_id=used_offer;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'reserved unit must disappear from offer availability'; END IF;
  phase := 9;
  PERFORM public.claim_variant_inventory_units_for_order_item(merchant,v_order_id,
    (SELECT oi.id FROM public.order_items oi WHERE oi.order_id=v_order_id LIMIT 1));
  IF (SELECT count(*) FROM public.variant_inventory WHERE order_id=v_order_id) <> 1 THEN
    RAISE EXCEPTION 'claim replay duplicated the reservation';
  END IF;
  phase := 10;
  UPDATE public.orders SET payment_status='paid' WHERE id=v_order_id;
  PERFORM public.confirm_order_inventory_reservations(merchant,v_order_id);
  IF EXISTS (SELECT 1 FROM public.variant_inventory WHERE id=used_unit AND reservation_expires_at IS NOT NULL) THEN
    RAISE EXCEPTION 'paid order must confirm its matching reservation';
  END IF;
EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN
  -- The replay runner deliberately redacts database errors. Preserve only
  -- the synthetic fixture phase so each failure has a distinct SQL line.
  PERFORM set_config('test.serialized_offer_failure_phase', phase::text, true);
END $$;
$fixture$;
EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN
  PERFORM set_config('test.serialized_offer_outer_error', SQLSTATE, true);
END $diagnostic$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) LIKE '22%' THEN RAISE EXCEPTION 'serialized fixture data error'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) LIKE '23%' THEN RAISE EXCEPTION 'serialized fixture constraint error'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) LIKE '40%' THEN RAISE EXCEPTION 'serialized fixture transaction error'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) = '42501' THEN RAISE EXCEPTION 'serialized fixture permission error'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) = '42702' THEN RAISE EXCEPTION 'serialized fixture ambiguous name'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) = '42703' THEN RAISE EXCEPTION 'serialized fixture undefined column'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) = '42883' THEN RAISE EXCEPTION 'serialized fixture undefined function'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) = '42P01' THEN RAISE EXCEPTION 'serialized fixture undefined relation'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) = '42601' THEN RAISE EXCEPTION 'serialized fixture syntax error'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) LIKE '42%' THEN RAISE EXCEPTION 'serialized fixture syntax or access error'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) LIKE '53%' OR current_setting('test.serialized_offer_outer_error',true) LIKE '54%' THEN RAISE EXCEPTION 'serialized fixture resource error'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) = '57014' THEN RAISE EXCEPTION 'serialized fixture canceled'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_outer_error',true) <> '00000' THEN RAISE EXCEPTION 'serialized fixture other error'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_failure_phase',true) = '1' THEN RAISE EXCEPTION 'serialized offer fixture phase 1 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_failure_phase',true) = '2' THEN RAISE EXCEPTION 'serialized offer fixture phase 2 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_failure_phase',true) = '3' THEN RAISE EXCEPTION 'serialized offer fixture phase 3 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_failure_phase',true) = '4' THEN RAISE EXCEPTION 'serialized offer fixture phase 4 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_failure_phase',true) = '5' THEN RAISE EXCEPTION 'serialized offer fixture phase 5 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_failure_phase',true) = '6' THEN RAISE EXCEPTION 'serialized offer fixture phase 6 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_failure_phase',true) = '7' THEN RAISE EXCEPTION 'serialized offer fixture phase 7 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_failure_phase',true) = '8' THEN RAISE EXCEPTION 'serialized offer fixture phase 8 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_failure_phase',true) = '9' THEN RAISE EXCEPTION 'serialized offer fixture phase 9 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.serialized_offer_failure_phase',true) = '10' THEN RAISE EXCEPTION 'serialized offer fixture phase 10 failed'; END IF; END $$;

ROLLBACK;
