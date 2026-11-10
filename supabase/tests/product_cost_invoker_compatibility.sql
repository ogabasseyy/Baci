-- Regression: revoking one product column must not break invoker triggers.
BEGIN;
\ir product_cost_access.fixture.inc.sql
\ir product_cost_access.helpers.inc.sql
SELECT set_config('baci.product_cost_access_cutover','web-and-mobile-admin-verified',true);
\ir ../operations/revoke-products-cost-price.inc.sql
DO $$
DECLARE signature text; definition text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.rebuild_sku_matrix_product_projection(uuid)',
    'public.commerce_cart_product_negotiable(uuid,uuid)',
    'public.commerce_cart_condition_pool_is_quantity_managed(uuid,uuid)',
    'public.commerce_cart_condition_supported(uuid,uuid,uuid,text)',
    'public.commerce_cart_build_checkout_snapshot(uuid,uuid)'
  ] LOOP
    IF (SELECT prosecdef FROM pg_proc WHERE oid=signature::regprocedure) THEN
      RAISE EXCEPTION 'Compatibility repair elevated %', signature;
    END IF;
    definition := pg_get_functiondef(signature::regprocedure);
    IF definition ~ 'to_jsonb\((p|product)\)'
      OR definition ~ 'SELECT \*[[:space:]]+INTO v_product[[:space:]]+FROM public.products' THEN
      RAISE EXCEPTION 'Whole-product read remains in %',signature;
    END IF;
  END LOOP;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','ca570000-0000-4000-8000-000000000001',true);
-- The real baseline AFTER UPDATE trigger calls the repaired invoker routine.
UPDATE public.products SET variant_model='sku_matrix', manage_stock=false
WHERE id='ca570000-0000-4000-8000-000000000201';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.products
    WHERE id='ca570000-0000-4000-8000-000000000201'
      AND variant_model='sku_matrix' AND default_variant_id IS NULL
      AND available_conditions='{}'::text[]) THEN
    RAISE EXCEPTION 'SKU projection did not preserve empty-variant behavior';
  END IF;
END $$;
-- Direct execution must also retain the caller's narrow SELECT privileges.
SELECT public.rebuild_sku_matrix_product_projection('ca570000-0000-4000-8000-000000000201');
SELECT pg_temp.assert_cost_query_denied('SELECT cost_price FROM public.products');
-- Switching away still invokes the trigger because OLD.variant_model was SKU.
UPDATE public.products SET variant_model='legacy'
WHERE id='ca570000-0000-4000-8000-000000000201';
-- Pure catalog helpers now work for authenticated shoppers without whole-row grants.
SELECT set_config('request.jwt.claim.sub','ca570000-0000-4000-8000-000000000006',true);
SELECT public.commerce_cart_product_negotiable(
  'ca570000-0000-4000-8000-000000000101','ca570000-0000-4000-8000-000000000201');
SELECT public.commerce_cart_condition_pool_is_quantity_managed(
  'ca570000-0000-4000-8000-000000000101','ca570000-0000-4000-8000-000000000201');
SELECT public.commerce_cart_condition_supported(
  'ca570000-0000-4000-8000-000000000101','ca570000-0000-4000-8000-000000000201',NULL,'new');
RESET ROLE;
ROLLBACK;
