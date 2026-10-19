-- Search option hydration receives per-product storefront windows directly
-- from the database; it must not transfer every variant/offer first.
BEGIN;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_variant_function oid := 'public.get_mcp_search_product_variants(uuid[],uuid)'::pg_catalog.regprocedure;
  v_offer_function oid := 'public.get_mcp_search_product_offers(uuid[],uuid)'::pg_catalog.regprocedure;
  v_anchor_function oid := 'public.get_mcp_search_serialized_anchor_policies(uuid[],uuid)'::pg_catalog.regprocedure;
  v_function oid;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[v_variant_function, v_offer_function, v_anchor_function] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS proc
      WHERE proc.oid = v_function
        AND proc.prosecdef
        AND proc.provolatile = 's'
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_options_to_table(
            COALESCE(proc.proconfig, ARRAY[]::text[])
          ) AS setting
          WHERE setting.option_name = 'search_path'
            AND pg_catalog.btrim(setting.option_value, '"') = ''
        )
    ) THEN
      RAISE EXCEPTION 'MCP option projection must be STABLE SECURITY DEFINER with blank search_path';
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
      OR NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'public storefront callers must execute MCP option projections';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(
        COALESCE(
          (SELECT proc.proacl FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_function),
          pg_catalog.acldefault('f', (SELECT proc.proowner FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_function))
        )
      ) AS privilege
      WHERE privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'PUBLIC must not execute MCP option projections';
    END IF;
  END LOOP;
END;
$$;

RESET ROLE;
ROLLBACK;
