BEGIN;

CREATE OR REPLACE FUNCTION public.replace_merchant_ads_spend_daily_window(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_provider_customer_id pg_catalog.text,
  p_start_date pg_catalog.date,
  p_end_date pg_catalog.date,
  p_rows pg_catalog.jsonb
)
RETURNS pg_catalog.int4
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row pg_catalog.jsonb;
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN 0;
  END IF;
  IF p_provider IS NULL
    OR p_provider NOT IN ('meta_ads', 'tiktok_ads', 'snapchat_ads')
    OR p_provider_customer_id IS NULL
    OR pg_catalog.btrim(p_provider_customer_id) = ''
    OR pg_catalog.char_length(p_provider_customer_id) > 255
    OR p_start_date IS NULL
    OR p_end_date IS NULL
    OR p_start_date > p_end_date
    OR pg_catalog.jsonb_typeof(COALESCE(p_rows, '[]'::pg_catalog.jsonb)) <> 'array'
    OR pg_catalog.jsonb_array_length(COALESCE(p_rows, '[]'::pg_catalog.jsonb)) > 400 THEN
    RAISE EXCEPTION 'invalid ads spend replacement window';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.merchant_ad_connections
    WHERE merchant_id = p_merchant_id
      AND provider = p_provider
      AND provider_customer_id = pg_catalog.btrim(p_provider_customer_id)
  ) THEN
    RAISE EXCEPTION 'ads account changed during spend replacement';
  END IF;

  FOR v_row IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_rows, '[]'::pg_catalog.jsonb))
  LOOP
    IF pg_catalog.jsonb_typeof(v_row) <> 'object'
      OR COALESCE((v_row ->> 'spend_date') !~ '^\d{4}-\d{2}-\d{2}$', true)
      OR (v_row ->> 'spend_date') < p_start_date::pg_catalog.text
      OR (v_row ->> 'spend_date') > p_end_date::pg_catalog.text
      OR (v_row ->> 'provider_customer_id') IS DISTINCT FROM
        pg_catalog.btrim(p_provider_customer_id) THEN
      RAISE EXCEPTION 'ads spend row is outside replacement account or window';
    END IF;
  END LOOP;

  DELETE FROM public.merchant_ad_spend_daily
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider
    AND provider_customer_id = pg_catalog.btrim(p_provider_customer_id)
    AND spend_date BETWEEN p_start_date AND p_end_date;

  RETURN public.upsert_merchant_ads_spend_daily(
    p_merchant_id,
    p_provider,
    COALESCE(p_rows, '[]'::pg_catalog.jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_merchant_ads_spend_daily_window(
  uuid, text, date, date, jsonb
) FROM authenticated, service_role;

REVOKE ALL ON FUNCTION public.replace_merchant_ads_spend_daily_window(
  uuid, text, text, date, date, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_merchant_ads_spend_daily_window(
  uuid, text, text, date, date, jsonb
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_merchant_ads_account(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_provider_customer_id pg_catalog.text,
  p_provider_account_label pg_catalog.text,
  p_account_timezone pg_catalog.text,
  p_attribution_metadata pg_catalog.jsonb,
  p_expected_access_token_ciphertext pg_catalog.text
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN false;
  END IF;
  IF p_provider NOT IN ('meta_ads', 'tiktok_ads', 'snapchat_ads')
    OR pg_catalog.char_length(p_provider_customer_id) > 255
    OR pg_catalog.btrim(p_provider_customer_id) = ''
    OR (p_provider_account_label IS NOT NULL
      AND pg_catalog.char_length(p_provider_account_label) > 255)
    OR (p_account_timezone IS NOT NULL
      AND (pg_catalog.char_length(p_account_timezone) > 128
        OR p_account_timezone !~ '^[A-Za-z0-9_+/-]+$'))
    OR pg_catalog.jsonb_typeof(
      COALESCE(p_attribution_metadata, '{}'::pg_catalog.jsonb)
    ) <> 'object' THEN
    RAISE EXCEPTION 'invalid ads account input';
  END IF;
  UPDATE public.merchant_ad_connections
  SET provider_customer_id = pg_catalog.btrim(p_provider_customer_id),
      provider_account_label = NULLIF(
        pg_catalog.btrim(p_provider_account_label), ''
      ),
      account_timezone = NULLIF(pg_catalog.btrim(p_account_timezone), ''),
      attribution_metadata = COALESCE(
        p_attribution_metadata, '{}'::pg_catalog.jsonb
      ),
      last_synced_at = CASE
        WHEN provider_customer_id IS DISTINCT FROM pg_catalog.btrim(
          p_provider_customer_id
        ) THEN NULL
        ELSE last_synced_at
      END
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider
    AND access_token_ciphertext IS NOT DISTINCT FROM p_expected_access_token_ciphertext;
  RETURN FOUND;
END;
$$;

COMMIT;
