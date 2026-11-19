-- REGRESSION TEST: anon must not be able to read public.products.cost_price.
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
  -- 3. authenticated + service_role unchanged (merchant dashboards keep working).
  IF NOT has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lost SELECT on products.cost_price (not in scope)';
  END IF;
  IF NOT has_column_privilege('service_role', 'public.products', 'cost_price', 'SELECT') THEN
    RAISE EXCEPTION 'service_role lost SELECT on products.cost_price';
  END IF;

  -- 4. product_variants.cost_price was never anon-readable by policy; keep it so.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'product_variants'
      AND cmd IN ('SELECT', 'ALL')
      AND ('anon' = ANY (roles) OR 'public' = ANY (roles))
  ) THEN
    RAISE EXCEPTION 'product_variants gained an anon/public SELECT policy';
  END IF;

  -- 5. Negotiation floor RPC: privileges and no leakage for unknown products.
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

ROLLBACK;
