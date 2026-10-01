-- Google Ads sync consistency: compare-and-set token refreshes and atomically
-- replace a selected account's requested daily reporting window.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_google_ads_connection_token_if_current(
  p_merchant_id pg_catalog.uuid,
  p_expected_access_token_ciphertext pg_catalog.text,
  p_expected_refresh_token_ciphertext pg_catalog.text,
  p_access_token_ciphertext pg_catalog.text,
  p_token_expires_at pg_catalog.timestamptz
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
  IF p_access_token_ciphertext IS NULL
    OR p_access_token_ciphertext !~ '^v1\.[^.]+\.[^.]+\.[^.]+$'
    OR (p_expected_access_token_ciphertext IS NOT NULL
      AND p_expected_access_token_ciphertext !~ '^v1\.[^.]+\.[^.]+\.[^.]+$')
    OR (p_expected_refresh_token_ciphertext IS NOT NULL
      AND p_expected_refresh_token_ciphertext !~ '^v1\.[^.]+\.[^.]+\.[^.]+$') THEN
    RAISE EXCEPTION 'invalid Google Ads token input';
  END IF;

  UPDATE public.merchant_ad_connections
  SET access_token_ciphertext = p_access_token_ciphertext,
      token_expires_at = p_token_expires_at
  WHERE merchant_id = p_merchant_id
    AND provider = 'google_ads'
    AND status = 'active'
    AND access_token_ciphertext IS NOT DISTINCT FROM p_expected_access_token_ciphertext
    AND refresh_token_ciphertext IS NOT DISTINCT FROM p_expected_refresh_token_ciphertext;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_google_ads_spend_daily(
  p_merchant_id pg_catalog.uuid,
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
  v_selected_customer_id pg_catalog.text;
  v_rows_written pg_catalog.int4 := 0;
  v_fetched_at pg_catalog.text;
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN 0;
  END IF;
  IF p_provider_customer_id IS NULL
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
    AND c.status = 'active';
  IF v_selected_customer_id IS NULL
    OR v_selected_customer_id <> p_provider_customer_id THEN
    RAISE EXCEPTION 'Google Ads customer is not selected';
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
    AND provider_customer_id = p_provider_customer_id
    AND spend_date BETWEEN p_start_date AND p_end_date;

  FOR v_row IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_rows, '[]'::pg_catalog.jsonb))
  LOOP
    INSERT INTO public.merchant_ad_spend_daily (
      merchant_id,
      provider,
      provider_customer_id,
      spend_date,
      currency_code,
      spend_micros,
      impressions,
      clicks,
      conversions,
      fetched_at
    ) VALUES (
      p_merchant_id,
      'google_ads',
      p_provider_customer_id,
      (v_row ->> 'spend_date')::pg_catalog.date,
      v_row ->> 'currency_code',
      (v_row ->> 'spend_micros')::pg_catalog.int8,
      (v_row ->> 'impressions')::pg_catalog.int8,
      (v_row ->> 'clicks')::pg_catalog.int8,
      (v_row ->> 'conversions')::pg_catalog.numeric,
      (v_row ->> 'fetched_at')::pg_catalog.timestamptz
    )
    ON CONFLICT (merchant_id, provider, provider_customer_id, spend_date)
    DO UPDATE SET
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

REVOKE ALL ON FUNCTION public.update_google_ads_connection_token_if_current(
  uuid, text, text, text, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_google_ads_connection_token_if_current(
  uuid, text, text, text, timestamptz
) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.replace_google_ads_spend_daily(
  uuid, text, date, date, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_google_ads_spend_daily(
  uuid, text, date, date, jsonb
) TO authenticated, service_role;

COMMIT;
