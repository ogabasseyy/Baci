-- Atomically persist per-variant Jumia prices.
--
-- The product update route used to write each variant price in its own
-- request, so a mid-loop failure committed a partial set the provider feed
-- never received. A partial-row upsert cannot replace the loop either:
-- PostgreSQL validates the NOT NULL candidate columns (product_id,
-- jumia_sku, jumia_shop_id) before resolving the id conflict, so every
-- call would fail. This function updates all rows in one transaction and
-- fails closed when any target is missing or belongs to another merchant.

CREATE OR REPLACE FUNCTION public.apply_jumia_variant_price_updates(
  p_merchant_id uuid,
  p_updates jsonb
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
    AND mapping.merchant_id = p_merchant_id;

  GET DIAGNOSTICS v_update_count = ROW_COUNT;
  IF v_update_count <> jsonb_array_length(p_updates) THEN
    RAISE EXCEPTION 'Jumia price update target not found'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_jumia_variant_price_updates(
  uuid, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_jumia_variant_price_updates(
  uuid, jsonb
) TO authenticated;
