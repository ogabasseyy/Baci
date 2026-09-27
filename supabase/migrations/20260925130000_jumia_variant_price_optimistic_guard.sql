-- Guard per-variant Jumia price writes against concurrent saves.
--
-- Each update carries the token its caller observed when the mappings
-- were loaded, and the atomic statement only overwrites rows still
-- carrying that baseline, restamping them with the caller's claim token.
-- Two overlapping saves can otherwise interleave so the earlier
-- request's feed resolves last and overwrites the later request's local
-- prices; rows claimed by a newer save no longer match, the row-count
-- check reports the call as superseded (SQLSTATE 40001) instead of
-- silently regressing them, and genuinely missing targets keep the
-- original 22023 failure. Claims happen at write time (never before the
-- provider feed is accepted), so a failed save cannot poison the token
-- an overlapping accepted save relies on.
--
-- Predeploy safety: the live route still calls the two-argument signature
-- while this migration runs ahead of the Vercel deploy, so the unguarded
-- overload is retained as a deprecated compatibility shim. Remove it in a
-- postdeploy migration once the token-passing revision is live.

ALTER TABLE public.jumia_product_mappings
  ADD COLUMN IF NOT EXISTS update_token text;

-- Deprecated compatibility shim for the live route during the predeploy
-- window. Matches the pre-guard behavior exactly (no token predicate).
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

CREATE OR REPLACE FUNCTION public.apply_jumia_variant_price_updates(
  p_merchant_id uuid,
  p_updates jsonb,
  p_update_token text
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
      FROM jsonb_to_recordset(p_updates)
        AS update_row(id uuid, price numeric, expected_token text)
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
    updated_at = now(),
    update_token = p_update_token
  FROM jsonb_to_recordset(p_updates)
    AS update_row(id uuid, price numeric, expected_token text)
  WHERE mapping.id = update_row.id
    AND mapping.merchant_id = p_merchant_id
    AND mapping.update_token IS NOT DISTINCT FROM update_row.expected_token;

  GET DIAGNOSTICS v_update_count = ROW_COUNT;
  IF v_update_count <> jsonb_array_length(p_updates) THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_updates)
        AS update_row(id uuid, price numeric, expected_token text)
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
  uuid, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_jumia_variant_price_updates(
  uuid, jsonb
) TO authenticated;
REVOKE ALL ON FUNCTION public.apply_jumia_variant_price_updates(
  uuid, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_jumia_variant_price_updates(
  uuid, jsonb, text
) TO authenticated;
