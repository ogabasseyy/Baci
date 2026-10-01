-- Close the provider-neutral ads review findings without changing an already
-- applied migration.  These replacements keep the existing RPC contracts but
-- accept digit-bearing IANA zones, invalidate stale reporting on account
-- changes, and make re-auth marking compare-and-set safe.

BEGIN;

CREATE OR REPLACE FUNCTION public.upsert_merchant_ads_connection(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_access_token_ciphertext pg_catalog.text,
  p_refresh_token_ciphertext pg_catalog.text,
  p_provider_customer_id pg_catalog.text,
  p_provider_account_label pg_catalog.text,
  p_scopes pg_catalog.text[],
  p_status pg_catalog.text,
  p_token_expires_at pg_catalog.timestamptz,
  p_account_timezone pg_catalog.text,
  p_attribution_metadata pg_catalog.jsonb,
  p_metadata pg_catalog.jsonb
)
RETURNS pg_catalog.uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id pg_catalog.uuid;
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN NULL;
  END IF;
  IF p_provider NOT IN ('meta_ads', 'tiktok_ads', 'snapchat_ads')
    OR p_status NOT IN ('active', 'disconnected', 'error')
    OR p_access_token_ciphertext !~ ('^v2\.' || p_provider || '\.[^.]+\.[^.]+\.[^.]+$')
    OR (p_refresh_token_ciphertext IS NOT NULL
      AND p_refresh_token_ciphertext !~ ('^v2\.' || p_provider || '\.[^.]+\.[^.]+\.[^.]+$'))
    OR (p_provider_customer_id IS NOT NULL
      AND (pg_catalog.char_length(p_provider_customer_id) > 255
        OR pg_catalog.btrim(p_provider_customer_id) = ''))
    OR (p_provider_account_label IS NOT NULL
      AND pg_catalog.char_length(p_provider_account_label) > 255)
    OR (p_account_timezone IS NOT NULL
      AND (pg_catalog.char_length(p_account_timezone) > 128
        OR p_account_timezone !~ '^[A-Za-z0-9_+/-]+$'))
    OR pg_catalog.jsonb_typeof(COALESCE(p_attribution_metadata, '{}'::pg_catalog.jsonb)) <> 'object'
    OR pg_catalog.jsonb_typeof(COALESCE(p_metadata, '{}'::pg_catalog.jsonb)) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(COALESCE(p_metadata, '{}'::pg_catalog.jsonb)) AS key_name
      WHERE pg_catalog.lower(key_name) ~ '(token|secret|credential|authorization)'
    ) THEN
    RAISE EXCEPTION 'invalid ads connection input';
  END IF;

  INSERT INTO public.merchant_ad_connections (
    merchant_id, provider, status, provider_customer_id,
    provider_account_label, access_token_ciphertext, refresh_token_ciphertext,
    token_expires_at, scopes, account_timezone, attribution_metadata, metadata
  ) VALUES (
    p_merchant_id, p_provider, p_status,
    NULLIF(pg_catalog.btrim(p_provider_customer_id), ''),
    NULLIF(pg_catalog.btrim(p_provider_account_label), ''),
    p_access_token_ciphertext, p_refresh_token_ciphertext, p_token_expires_at,
    COALESCE(p_scopes, ARRAY[]::pg_catalog.text[]),
    NULLIF(pg_catalog.btrim(p_account_timezone), ''),
    COALESCE(p_attribution_metadata, '{}'::pg_catalog.jsonb),
    COALESCE(p_metadata, '{}'::pg_catalog.jsonb)
  )
  ON CONFLICT (merchant_id, provider) DO UPDATE SET
    status = EXCLUDED.status,
    provider_customer_id = EXCLUDED.provider_customer_id,
    provider_account_label = EXCLUDED.provider_account_label,
    access_token_ciphertext = EXCLUDED.access_token_ciphertext,
    refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
    token_expires_at = EXCLUDED.token_expires_at,
    scopes = EXCLUDED.scopes,
    account_timezone = EXCLUDED.account_timezone,
    attribution_metadata = EXCLUDED.attribution_metadata,
    metadata = EXCLUDED.metadata
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_merchant_ads_account(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_provider_customer_id pg_catalog.text,
  p_provider_account_label pg_catalog.text,
  p_account_timezone pg_catalog.text,
  p_attribution_metadata pg_catalog.jsonb
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
    OR pg_catalog.jsonb_typeof(COALESCE(p_attribution_metadata, '{}'::pg_catalog.jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid ads account input';
  END IF;
  UPDATE public.merchant_ad_connections
  SET provider_customer_id = pg_catalog.btrim(p_provider_customer_id),
      provider_account_label = NULLIF(pg_catalog.btrim(p_provider_account_label), ''),
      account_timezone = NULLIF(pg_catalog.btrim(p_account_timezone), ''),
      attribution_metadata = COALESCE(p_attribution_metadata, '{}'::pg_catalog.jsonb),
      last_synced_at = CASE
        WHEN provider_customer_id IS DISTINCT FROM pg_catalog.btrim(p_provider_customer_id)
          THEN NULL
        ELSE last_synced_at
      END
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_merchant_ads_spend_daily(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
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
  v_spend_amount_decimal pg_catalog.text;
  v_fetched_at pg_catalog.text;
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN 0;
  END IF;
  IF p_provider NOT IN ('meta_ads', 'tiktok_ads', 'snapchat_ads')
    OR pg_catalog.jsonb_typeof(COALESCE(p_rows, '[]'::pg_catalog.jsonb)) <> 'array'
    OR pg_catalog.jsonb_array_length(COALESCE(p_rows, '[]'::pg_catalog.jsonb)) > 400 THEN
    RAISE EXCEPTION 'invalid ads spend rows';
  END IF;

  SELECT c.provider_customer_id INTO v_selected_customer_id
  FROM public.merchant_ad_connections AS c
  WHERE c.merchant_id = p_merchant_id
    AND c.provider = p_provider
    AND c.status = 'active';
  IF v_selected_customer_id IS NULL THEN
    RAISE EXCEPTION 'ads account is not selected';
  END IF;

  FOR v_row IN
    SELECT value FROM pg_catalog.jsonb_array_elements(COALESCE(p_rows, '[]'::pg_catalog.jsonb))
  LOOP
    v_spend_amount_decimal := v_row ->> 'spend_amount_decimal';
    v_fetched_at := v_row ->> 'fetched_at';
    IF pg_catalog.jsonb_typeof(v_row) <> 'object'
      OR COALESCE(v_row ->> 'provider_customer_id' <> v_selected_customer_id, true)
      OR COALESCE((v_row ->> 'spend_date') !~ '^\d{4}-\d{2}-\d{2}$', true)
      OR COALESCE((v_row ->> 'currency_code') !~ '^[A-Z]{3}$', true)
      OR COALESCE(v_spend_amount_decimal !~ '^\d+(\.\d{1,9})?$', true)
      OR COALESCE((v_row ->> 'spend_micros') !~ '^\d+$', true)
      OR COALESCE((v_row ->> 'impressions') !~ '^\d+$', true)
      OR COALESCE((v_row ->> 'clicks') !~ '^\d+$', true)
      OR COALESCE((v_row ->> 'conversions') !~ '^\d+(\.\d+)?$', true)
      OR COALESCE((v_row ->> 'reach') IS NOT NULL AND (v_row ->> 'reach') !~ '^\d+$', false)
      OR COALESCE((v_row ->> 'account_timezone') !~ '^[A-Za-z0-9_+/-]+$', true)
      OR pg_catalog.jsonb_typeof(COALESCE(v_row -> 'attribution_metadata', '{}'::pg_catalog.jsonb)) <> 'object'
      OR COALESCE(v_fetched_at !~ '^\d{4}-\d{2}-\d{2}T', true) THEN
      RAISE EXCEPTION 'invalid ads spend row';
    END IF;

    INSERT INTO public.merchant_ad_spend_daily (
      merchant_id, provider, provider_customer_id, spend_date, currency_code,
      spend_micros, spend_amount_decimal, impressions, clicks, conversions,
      reach, account_timezone, attribution_metadata, fetched_at
    ) VALUES (
      p_merchant_id, p_provider, v_selected_customer_id,
      (v_row ->> 'spend_date')::pg_catalog.date,
      v_row ->> 'currency_code',
      (v_row ->> 'spend_micros')::pg_catalog.int8,
      v_spend_amount_decimal::pg_catalog.numeric,
      (v_row ->> 'impressions')::pg_catalog.int8,
      (v_row ->> 'clicks')::pg_catalog.int8,
      (v_row ->> 'conversions')::pg_catalog.numeric,
      NULLIF(v_row ->> 'reach', '')::pg_catalog.int8,
      v_row ->> 'account_timezone',
      COALESCE(v_row -> 'attribution_metadata', '{}'::pg_catalog.jsonb),
      v_fetched_at::pg_catalog.timestamptz
    )
    ON CONFLICT (merchant_id, provider, provider_customer_id, spend_date) DO UPDATE SET
      currency_code = EXCLUDED.currency_code,
      spend_micros = EXCLUDED.spend_micros,
      spend_amount_decimal = EXCLUDED.spend_amount_decimal,
      impressions = EXCLUDED.impressions,
      clicks = EXCLUDED.clicks,
      conversions = EXCLUDED.conversions,
      reach = EXCLUDED.reach,
      account_timezone = EXCLUDED.account_timezone,
      attribution_metadata = EXCLUDED.attribution_metadata,
      fetched_at = EXCLUDED.fetched_at;
    v_rows_written := v_rows_written + 1;
  END LOOP;
  RETURN v_rows_written;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_google_ads_customer(
  p_merchant_id uuid,
  p_provider_customer_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN false;
  END IF;
  IF p_provider_customer_id !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'invalid Google Ads customer id';
  END IF;
  UPDATE public.merchant_ad_connections
  SET provider_customer_id = p_provider_customer_id,
      last_synced_at = CASE
        WHEN provider_customer_id IS DISTINCT FROM p_provider_customer_id
          THEN NULL
        ELSE last_synced_at
      END
  WHERE merchant_id = p_merchant_id
    AND provider = 'google_ads';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_google_ads_spend_daily(
  p_merchant_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_customer_id text;
  v_selected_customer_id text;
  v_rows_written integer := 0;
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN 0;
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) > 400 THEN
    RAISE EXCEPTION 'invalid Google Ads spend rows';
  END IF;

  SELECT c.provider_customer_id
    INTO v_selected_customer_id
  FROM public.merchant_ad_connections AS c
  WHERE c.merchant_id = p_merchant_id
    AND c.provider = 'google_ads'
    AND c.status = 'active';
  IF v_selected_customer_id IS NULL THEN
    RAISE EXCEPTION 'Google Ads customer is not selected';
  END IF;

  FOR v_row IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_customer_id := v_row ->> 'provider_customer_id';
    IF v_customer_id IS NULL
      OR v_customer_id !~ '^[0-9]{10}$'
      OR v_customer_id <> v_selected_customer_id
      OR (v_row ->> 'spend_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR (v_row ->> 'currency_code') !~ '^[A-Z]{3}$' THEN
      RAISE EXCEPTION 'invalid Google Ads spend row';
    END IF;

    INSERT INTO public.merchant_ad_spend_daily (
      merchant_id, provider, provider_customer_id, spend_date, currency_code,
      spend_micros, impressions, clicks, conversions, fetched_at
    ) VALUES (
      p_merchant_id, 'google_ads', v_customer_id,
      (v_row ->> 'spend_date')::date,
      v_row ->> 'currency_code',
      (v_row ->> 'spend_micros')::bigint,
      (v_row ->> 'impressions')::bigint,
      (v_row ->> 'clicks')::bigint,
      (v_row ->> 'conversions')::numeric,
      COALESCE((v_row ->> 'fetched_at')::timestamptz, now())
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

CREATE OR REPLACE FUNCTION public.mark_merchant_ads_connection_reauth_if_current(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_access_token_ciphertext pg_catalog.text,
  p_refresh_token_ciphertext pg_catalog.text,
  p_reason pg_catalog.text
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
    OR p_access_token_ciphertext !~ ('^v2\.' || p_provider || '\.[^.]+\.[^.]+\.[^.]+$')
    OR (p_refresh_token_ciphertext IS NOT NULL
      AND p_refresh_token_ciphertext !~ ('^v2\.' || p_provider || '\.[^.]+\.[^.]+\.[^.]+$'))
    OR pg_catalog.char_length(p_reason) > 128
    OR p_reason !~ '^[A-Za-z0-9_.-]+$' THEN
    RAISE EXCEPTION 'invalid ads reauth input';
  END IF;
  UPDATE public.merchant_ad_connections
  SET status = 'error',
      token_expires_at = NULL,
      metadata = pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          COALESCE(metadata, '{}'::pg_catalog.jsonb),
          '{reauthRequired}', 'true'::pg_catalog.jsonb, true
        ),
        '{reauthReason}', pg_catalog.to_jsonb(p_reason), true
      ),
      attribution_metadata = pg_catalog.jsonb_set(
        COALESCE(attribution_metadata, '{}'::pg_catalog.jsonb),
        '{reauthRequired}', 'true'::pg_catalog.jsonb, true
      )
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider
    AND access_token_ciphertext = p_access_token_ciphertext
    AND refresh_token_ciphertext IS NOT DISTINCT FROM p_refresh_token_ciphertext;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_merchant_ads_connection_reauth_if_current(
  uuid, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_merchant_ads_connection_reauth_if_current(
  uuid, text, text, text, text
) TO authenticated, service_role;

COMMIT;
