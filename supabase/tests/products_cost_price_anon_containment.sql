-- REGRESSION TEST: anon must not be able to read public.products.cost_price.
--
-- Final activation: both anonymous and authenticated clients must use the
-- permitted column projection. Authorized costs use merchant_products instead.

BEGIN;

DO $$
BEGIN
  IF has_column_privilege('anon', 'public.products', 'cost_price', 'SELECT')
     OR has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT') THEN
    RAISE EXCEPTION 'A shopper role can still select products.cost_price';
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
