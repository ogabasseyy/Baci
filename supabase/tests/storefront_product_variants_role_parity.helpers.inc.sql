-- Include-only helper for storefront_product_variants_role_parity.sql (no BEGIN/ROLLBACK): the suite loads it with \ir.
-- The helper is called after SET ROLE, so it needs an explicit GRANT (new functions are
-- not executable by other roles by default).

CREATE OR REPLACE FUNCTION pg_temp.assert_storefront_variant_ids(
  p_claim_role text,
  p_user_id uuid,
  p_expected uuid[]
) RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_actual uuid[];
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role',
    p_claim_role,
    true
  );
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', COALESCE(p_user_id::text, ''), true
  );

  SELECT pg_catalog.array_agg(result.id ORDER BY result.ordinality)
    INTO v_actual
  FROM public.get_storefront_product_variants(ARRAY[
    '7f9d0e12-0000-4000-8000-000000000201'::uuid,
    '7f9d0e12-0000-4000-8000-000000000202'::uuid,
    '7f9d0e12-0000-4000-8000-000000000203'::uuid
  ]) WITH ORDINALITY AS result;

  IF COALESCE(v_actual, ARRAY[]::uuid[]) IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'expected variant ids %, got %', p_expected, v_actual;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_storefront_variant_ids(text, uuid, uuid[]) TO PUBLIC; -- called after SET ROLE
