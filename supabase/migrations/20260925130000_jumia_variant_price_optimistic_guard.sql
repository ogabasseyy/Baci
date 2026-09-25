-- Guard per-variant Jumia price writes against concurrent saves.
--
-- The product update route stamps every ready mapping with the request's
-- pre-push timestamp before submitting the provider feed. Two overlapping
-- saves can otherwise interleave so the earlier request's feed resolves
-- last and its RPC call overwrites the later request's local prices. The
-- expected stamp is now a predicate of the atomic update: rows touched by
-- a newer save no longer match, the row-count check reports the call as
-- superseded (SQLSTATE 40001) instead of silently regressing them, and
-- genuinely missing targets keep the original 22023 failure.

DROP FUNCTION IF EXISTS public.apply_jumia_variant_price_updates(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.apply_jumia_variant_price_updates(
  p_merchant_id uuid,
  p_updates jsonb,
  p_expected_updated_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_update_count integer;
BEGIN
  IF v_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id AND merchant.user_id = v_user_id
    ) OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage Jumia connections'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_updates) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_updates) < 1
    OR EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_updates) AS update_row(id uuid, price numeric)
      WHERE update_row.id IS NULL
        OR update_row.price IS NULL
        OR update_row.price <= 0
    )
  THEN
    RAISE EXCEPTION 'Invalid Jumia price updates' USING ERRCODE = '22023';
  END IF;

  UPDATE public.jumia_product_mappings AS mapping
  SET
    jumia_price = update_row.price,
    updated_at = now()
  FROM jsonb_to_recordset(p_updates) AS update_row(id uuid, price numeric)
  WHERE mapping.id = update_row.id
    AND mapping.merchant_id = p_merchant_id
    AND mapping.updated_at = p_expected_updated_at;

  GET DIAGNOSTICS v_update_count = ROW_COUNT;
  IF v_update_count <> jsonb_array_length(p_updates) THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_updates) AS update_row(id uuid, price numeric)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.jumia_product_mappings AS mapping
        WHERE mapping.id = update_row.id
          AND mapping.merchant_id = p_merchant_id
      )
    ) THEN
      RAISE EXCEPTION 'Jumia price update target not found'
        USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'Jumia price update superseded by a newer save'
      USING ERRCODE = '40001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_jumia_variant_price_updates(
  uuid, jsonb, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_jumia_variant_price_updates(
  uuid, jsonb, timestamptz
) TO authenticated;
