-- REGRESSION TEST (stage 1 of 2): negotiation floor RPC invariants.
-- This does NOT assert anon cannot read products.cost_price; that assertion
-- ships with stage 2 (products_anon_column_grants_guard.sql).
--
-- Stage 1 (additive): locks the invariants of
-- 20261110090000_negotiation_cost_floor_rpc.sql. The anon column-grant checks
-- ship with the separate stage-2 migration. Assertions read the
-- catalog (has_column_privilege / has_function_privilege); nothing calls a
-- denied statement and catches the error.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/products_cost_price_anon_containment.sql
--
-- NOTE: authenticated still reads cost_price on purpose (tracked in the
-- containment report). Section 3 pins that so a later change is deliberate.

BEGIN;

DO $$
BEGIN
  -- 1. authenticated + service_role unchanged (merchant dashboards keep working).
  IF NOT has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lost SELECT on products.cost_price (not in scope)';
  END IF;
  IF NOT has_column_privilege('service_role', 'public.products', 'cost_price', 'SELECT') THEN
    RAISE EXCEPTION 'service_role lost SELECT on products.cost_price';
  END IF;

  -- 2. product_variants.cost_price was never anon-readable by policy; keep it so.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'product_variants'
      AND cmd IN ('SELECT', 'ALL')
      AND ('anon' = ANY (roles) OR 'public' = ANY (roles))
  ) THEN
    RAISE EXCEPTION 'product_variants gained an anon/public SELECT policy';
  END IF;

  -- 3. Negotiation floor RPC: privileges and no leakage for unknown products.
  IF NOT has_function_privilege('anon', 'public.get_negotiation_cost_floor_price(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon cannot execute get_negotiation_cost_floor_price';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc
          WHERE oid = 'public.get_negotiation_cost_floor_price(uuid, uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'get_negotiation_cost_floor_price must be SECURITY DEFINER';
  END IF;
  IF public.get_negotiation_cost_floor_price(gen_random_uuid(), gen_random_uuid()) IS NOT NULL THEN
    RAISE EXCEPTION 'floor RPC returned a value for a product that does not exist';
  END IF;
END $$;

-- 4. Floor behaviour against real rows (rollback-only). FK/trigger checks are
-- bypassed for the fixtures only; the function itself is called as written.
SET LOCAL session_replication_role = replica;

DO $$
DECLARE
  m  uuid := gen_random_uuid();
  m2 uuid := gen_random_uuid();
  p_cost  uuid := gen_random_uuid();  -- cost dominates: 950 * 1.1 = 1045 > 980
  p_price uuid := gen_random_uuid();  -- price cap dominates: 500 * 1.1 = 550 < 980
  p_zero  uuid := gen_random_uuid();  -- zero cost -> fallback 0.6, price cap wins
  p_null  uuid := gen_random_uuid();  -- null cost -> fallback 0.6, price cap wins
  p_off   uuid := gen_random_uuid();  -- inactive
BEGIN
  INSERT INTO public.products (id, merchant_id, name, price, cost_price, status) VALUES
    (p_cost,  m, 'cost dominates',  1000, 950,  'active'),
    (p_price, m, 'price dominates', 1000, 500,  'active'),
    (p_zero,  m, 'zero cost',       1000, 0,    'active'),
    (p_null,  m, 'null cost',       1000, NULL, 'active'),
    (p_off,   m, 'inactive',        1000, 950,  'draft');

  IF public.get_negotiation_cost_floor_price(p_cost, m) <> 1045 THEN
    RAISE EXCEPTION 'cost-dominated floor should be cost*1.1 (1045), got %',
      public.get_negotiation_cost_floor_price(p_cost, m);
  END IF;
  IF public.get_negotiation_cost_floor_price(p_price, m) <> 980 THEN
    RAISE EXCEPTION 'price-dominated floor should be price*0.98 (980)';
  END IF;
  IF public.get_negotiation_cost_floor_price(p_zero, m) <> 980
     OR public.get_negotiation_cost_floor_price(p_null, m) <> 980 THEN
    RAISE EXCEPTION 'zero/null cost floor should fall back and resolve to price*0.98';
  END IF;
  IF public.get_negotiation_cost_floor_price(p_cost, m2) IS NOT NULL THEN
    RAISE EXCEPTION 'floor returned for a mismatched merchant';
  END IF;
  IF public.get_negotiation_cost_floor_price(p_off, m) IS NOT NULL THEN
    RAISE EXCEPTION 'floor returned for an inactive product';
  END IF;
END $$;

ROLLBACK;
