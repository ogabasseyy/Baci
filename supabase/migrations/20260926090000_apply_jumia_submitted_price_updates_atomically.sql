-- Apply an accepted Jumia price feed atomically: scalar sale overrides and
-- per-variant prices commit together or not at all.
--
-- The previous revision claimed scalar sale metadata with a REST update and
-- checked the row count in application code; a shortfall left the matching
-- rows claimed while the stale rows were untouched, so an accepted all-SKU
-- sale feed could persist sale metadata on only some variants. This RPC
-- performs both guarded writes and both cardinality checks in a single
-- transaction: any baseline miss raises 40001 and rolls back every row,
-- while genuinely missing targets keep the original 22023 failure.
--
-- The three-argument per-variant overload never reached production (it was
-- introduced earlier in this unmerged branch), so it is replaced outright
-- by the combined RPC instead of lingering as a dead overload. The
-- two-argument shim stays for the predeploy window: the live route still
-- calls it while this migration runs ahead of the Vercel deploy. Remove it
-- in a postdeploy migration once the token-passing revision is live.

DROP FUNCTION IF EXISTS public.apply_jumia_variant_price_updates(
  uuid, jsonb, text
);

CREATE OR REPLACE FUNCTION public.apply_jumia_submitted_price_updates(
  p_merchant_id uuid,
  p_scalar jsonb,
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
  v_scalar_values jsonb := COALESCE(p_scalar -> 'values', '{}'::jsonb);
  v_scalar_targets jsonb := COALESCE(p_scalar -> 'targets', '[]'::jsonb);
  v_price_updates jsonb := COALESCE(p_updates, '[]'::jsonb);
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

  IF jsonb_typeof(p_scalar) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_scalar_values) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_scalar_targets) IS DISTINCT FROM 'array'
    OR (v_scalar_values - ARRAY[
      'updated_at', 'jumia_price', 'jumia_sale_price',
      'jumia_sale_start', 'jumia_sale_end'
    ]) <> '{}'::jsonb
    OR EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(v_scalar_targets) AS target_row(id uuid)
      WHERE target_row.id IS NULL
    )
  THEN
    RAISE EXCEPTION 'Invalid Jumia submitted price update'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_price_updates) IS DISTINCT FROM 'array'
    OR EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(v_price_updates)
        AS update_row(id uuid, price numeric, expected_token text)
      WHERE update_row.id IS NULL
        OR update_row.price IS NULL
        OR update_row.price <= 0
    )
  THEN
    RAISE EXCEPTION 'Invalid Jumia price updates' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(v_scalar_targets) > 0 THEN
    IF NOT (v_scalar_values ? 'updated_at') THEN
      RAISE EXCEPTION 'Invalid Jumia submitted price update'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.jumia_product_mappings AS mapping
    SET
      jumia_price = CASE
        WHEN v_scalar_values ? 'jumia_price'
        THEN (v_scalar_values ->> 'jumia_price')::numeric
        ELSE mapping.jumia_price
      END,
      jumia_sale_price = CASE
        WHEN v_scalar_values ? 'jumia_sale_price'
        THEN (v_scalar_values ->> 'jumia_sale_price')::numeric
        ELSE mapping.jumia_sale_price
      END,
      jumia_sale_start = CASE
        WHEN v_scalar_values ? 'jumia_sale_start'
        THEN (v_scalar_values ->> 'jumia_sale_start')::timestamptz
        ELSE mapping.jumia_sale_start
      END,
      jumia_sale_end = CASE
        WHEN v_scalar_values ? 'jumia_sale_end'
        THEN (v_scalar_values ->> 'jumia_sale_end')::timestamptz
        ELSE mapping.jumia_sale_end
      END,
      updated_at = (v_scalar_values ->> 'updated_at')::timestamptz,
      update_token = p_update_token
    FROM jsonb_to_recordset(v_scalar_targets)
      AS target_row(id uuid, expected_token text)
    WHERE mapping.id = target_row.id
      AND mapping.merchant_id = p_merchant_id
      AND mapping.update_token IS NOT DISTINCT FROM target_row.expected_token;

    GET DIAGNOSTICS v_update_count = ROW_COUNT;
    IF v_update_count <> jsonb_array_length(v_scalar_targets) THEN
      IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(v_scalar_targets)
          AS target_row(id uuid, expected_token text)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.jumia_product_mappings AS mapping
          WHERE mapping.id = target_row.id
            AND mapping.merchant_id = p_merchant_id
        )
      ) THEN
        RAISE EXCEPTION 'Jumia price update target not found'
          USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'Jumia price update superseded by a newer save'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  IF jsonb_array_length(v_price_updates) > 0 THEN
    UPDATE public.jumia_product_mappings AS mapping
    SET
      jumia_price = update_row.price,
      updated_at = now(),
      update_token = p_update_token
    FROM jsonb_to_recordset(v_price_updates)
      AS update_row(id uuid, price numeric, expected_token text)
    WHERE mapping.id = update_row.id
      AND mapping.merchant_id = p_merchant_id
      AND mapping.update_token IS NOT DISTINCT FROM (
        CASE WHEN EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(v_scalar_targets) AS claimed_row(id uuid)
          WHERE claimed_row.id = update_row.id
        ) THEN p_update_token ELSE update_row.expected_token END
      );

    GET DIAGNOSTICS v_update_count = ROW_COUNT;
    IF v_update_count <> jsonb_array_length(v_price_updates) THEN
      IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(v_price_updates)
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
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_jumia_submitted_price_updates(
  uuid, jsonb, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_jumia_submitted_price_updates(
  uuid, jsonb, jsonb, text
) TO authenticated;
