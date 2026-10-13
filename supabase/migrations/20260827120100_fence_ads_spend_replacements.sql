-- Bind server-side Ads spend replacement to the same run fence used by the
-- authenticated start/final markers. The connection row lock serializes a
-- replacement with a later run start and keeps stale chunks from writing.

BEGIN;

DROP FUNCTION IF EXISTS public.replace_merchant_ads_spend_daily_window(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.text,
  pg_catalog.date, pg_catalog.date, pg_catalog.jsonb
);
DROP FUNCTION IF EXISTS public.replace_google_ads_spend_daily(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.date,
  pg_catalog.date, pg_catalog.jsonb
);

CREATE OR REPLACE FUNCTION public.replace_merchant_ads_spend_daily_window(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_provider_customer_id pg_catalog.text,
  p_start_date pg_catalog.date,
  p_end_date pg_catalog.date,
  p_rows pg_catalog.jsonb,
  p_sync_run_id pg_catalog.uuid
)
RETURNS pg_catalog.int4
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row pg_catalog.jsonb;
  v_selected_customer_id pg_catalog.text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'server Ads spend authority required' USING ERRCODE = '42501';
  END IF;
  IF p_sync_run_id IS NULL
    OR p_provider IS NULL
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

  SELECT c.provider_customer_id
  INTO v_selected_customer_id
  FROM public.merchant_ad_connections AS c
  WHERE c.merchant_id = p_merchant_id
    AND c.provider = p_provider
    AND c.provider_customer_id = pg_catalog.btrim(p_provider_customer_id)
    AND c.status = 'active'
    AND c.sync_run_id = p_sync_run_id
  FOR UPDATE;
  IF NOT FOUND OR v_selected_customer_id IS NULL THEN
    RAISE EXCEPTION 'ads sync run changed during spend replacement';
  END IF;

  FOR v_row IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_rows, '[]'::pg_catalog.jsonb))
  LOOP
    IF pg_catalog.jsonb_typeof(v_row) <> 'object'
      OR COALESCE((v_row ->> 'spend_date') !~ '^\d{4}-\d{2}-\d{2}$', true)
      OR (v_row ->> 'spend_date') < p_start_date::pg_catalog.text
      OR (v_row ->> 'spend_date') > p_end_date::pg_catalog.text
      OR (v_row ->> 'provider_customer_id') IS DISTINCT FROM v_selected_customer_id THEN
      RAISE EXCEPTION 'ads spend row is outside replacement account or window';
    END IF;
  END LOOP;

  DELETE FROM public.merchant_ad_spend_daily
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider
    AND provider_customer_id = v_selected_customer_id
    AND spend_date BETWEEN p_start_date AND p_end_date;

  RETURN public.upsert_merchant_ads_spend_daily(
    p_merchant_id,
    p_provider,
    COALESCE(p_rows, '[]'::pg_catalog.jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_google_ads_spend_daily(
  p_merchant_id pg_catalog.uuid,
  p_provider_customer_id pg_catalog.text,
  p_start_date pg_catalog.date,
  p_end_date pg_catalog.date,
  p_rows pg_catalog.jsonb,
  p_sync_run_id pg_catalog.uuid
)
RETURNS pg_catalog.int4
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row pg_catalog.jsonb;
  v_selected_customer_id pg_catalog.text;
  v_rows_written pg_catalog.int4 := 0;
  v_fetched_at pg_catalog.text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'server Ads spend authority required' USING ERRCODE = '42501';
  END IF;
  IF p_sync_run_id IS NULL
    OR p_provider_customer_id IS NULL
    OR p_provider_customer_id !~ '^[0-9]{10}$'
    OR p_start_date IS NULL
    OR p_end_date IS NULL
    OR p_start_date > p_end_date
    OR pg_catalog.jsonb_typeof(COALESCE(p_rows, '[]'::pg_catalog.jsonb)) <> 'array'
    OR pg_catalog.jsonb_array_length(COALESCE(p_rows, '[]'::pg_catalog.jsonb)) > 400 THEN
    RAISE EXCEPTION 'invalid Google Ads spend replacement input';
  END IF;

  SELECT c.provider_customer_id
  INTO v_selected_customer_id
  FROM public.merchant_ad_connections AS c
  WHERE c.merchant_id = p_merchant_id
    AND c.provider = 'google_ads'
    AND c.status = 'active'
    AND c.provider_customer_id = p_provider_customer_id
    AND c.sync_run_id = p_sync_run_id
  FOR UPDATE;
  IF NOT FOUND OR v_selected_customer_id IS NULL THEN
    RAISE EXCEPTION 'Google Ads sync run changed during spend replacement';
  END IF;

  FOR v_row IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_rows, '[]'::pg_catalog.jsonb))
  LOOP
    v_fetched_at := v_row ->> 'fetched_at';
    IF pg_catalog.jsonb_typeof(v_row) <> 'object'
      OR COALESCE(v_row ->> 'provider_customer_id' <> v_selected_customer_id, true)
      OR COALESCE((v_row ->> 'spend_date') !~ '^\d{4}-\d{2}-\d{2}$', true)
      OR COALESCE((v_row ->> 'currency_code') !~ '^[A-Z]{3}$', true)
      OR COALESCE((v_row ->> 'spend_micros') !~ '^\d+$', true)
      OR COALESCE((v_row ->> 'impressions') !~ '^\d+$', true)
      OR COALESCE((v_row ->> 'clicks') !~ '^\d+$', true)
      OR COALESCE((v_row ->> 'conversions') !~ '^\d+(\.\d+)?$', true)
      OR COALESCE(v_fetched_at !~ '^\d{4}-\d{2}-\d{2}T', true)
      OR (v_row ->> 'spend_date')::pg_catalog.date NOT BETWEEN p_start_date AND p_end_date THEN
      RAISE EXCEPTION 'invalid Google Ads spend replacement row';
    END IF;
  END LOOP;

  DELETE FROM public.merchant_ad_spend_daily
  WHERE merchant_id = p_merchant_id
    AND provider = 'google_ads'
    AND provider_customer_id = v_selected_customer_id
    AND spend_date BETWEEN p_start_date AND p_end_date;

  FOR v_row IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_rows, '[]'::pg_catalog.jsonb))
  LOOP
    INSERT INTO public.merchant_ad_spend_daily (
      merchant_id, provider, provider_customer_id, spend_date, currency_code,
      spend_micros, impressions, clicks, conversions, fetched_at
    ) VALUES (
      p_merchant_id, 'google_ads', v_selected_customer_id,
      (v_row ->> 'spend_date')::pg_catalog.date,
      v_row ->> 'currency_code',
      (v_row ->> 'spend_micros')::pg_catalog.int8,
      (v_row ->> 'impressions')::pg_catalog.int8,
      (v_row ->> 'clicks')::pg_catalog.int8,
      (v_row ->> 'conversions')::pg_catalog.numeric,
      (v_row ->> 'fetched_at')::pg_catalog.timestamptz
    )
    ON CONFLICT (merchant_id, provider, provider_customer_id, spend_date) DO UPDATE SET
      currency_code = EXCLUDED.currency_code,
      spend_micros = EXCLUDED.spend_micros,
      impressions = EXCLUDED.impressions,
      clicks = EXCLUDED.clicks,
      conversions = EXCLUDED.conversions,
      fetched_at = EXCLUDED.fetched_at;
    v_rows_written := v_rows_written + 1;
  END LOOP;
  RETURN v_rows_written;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_merchant_ads_spend_daily_window(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.text,
  pg_catalog.date, pg_catalog.date, pg_catalog.jsonb, pg_catalog.uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_merchant_ads_spend_daily_window(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.text,
  pg_catalog.date, pg_catalog.date, pg_catalog.jsonb, pg_catalog.uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.replace_google_ads_spend_daily(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.date,
  pg_catalog.date, pg_catalog.jsonb, pg_catalog.uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_google_ads_spend_daily(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.date,
  pg_catalog.date, pg_catalog.jsonb, pg_catalog.uuid
) TO service_role;

COMMIT;
