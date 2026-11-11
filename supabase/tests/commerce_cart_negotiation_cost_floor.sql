-- REGRESSION TEST: cart auto-accept must consult the cost floor.
-- Catalog assertions only (no call-and-catch of denied statements).
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/commerce_cart_negotiation_cost_floor.sql
BEGIN;

DO $$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  WHERE p.oid = 'public.commerce_cart_negotiation_auto_accepts(uuid,uuid,uuid,bigint)'::regprocedure;

  IF v_src NOT LIKE '%get_negotiation_cost_floor_price%' THEN
    RAISE EXCEPTION 'auto-accept no longer consults get_negotiation_cost_floor_price';
  END IF;
  IF v_src NOT LIKE '%p_negotiated < 0%' THEN
    RAISE EXCEPTION 'auto-accept lost zero-price handling from 20261015179910';
  END IF;
  IF v_src NOT LIKE '%* 100 <= v_catalog::bigint * 2%' THEN
    RAISE EXCEPTION 'auto-accept lost the 2%% discount band';
  END IF;

  -- The dependency stays the only cost-reading path for the cart.
  IF NOT has_function_privilege('anon',
       'public.get_negotiation_cost_floor_price(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'cost floor function not callable by anon';
  END IF;
END
$$;

ROLLBACK;
