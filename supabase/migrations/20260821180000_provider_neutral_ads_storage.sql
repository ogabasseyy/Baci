-- Provider-neutral ads connections and normalized daily reporting.
-- This migration intentionally extends the immutable Google Ads baseline.

BEGIN;

ALTER TABLE public.merchant_ad_connections
  DROP CONSTRAINT IF EXISTS merchant_ad_connections_provider_check;
ALTER TABLE public.merchant_ad_connections
  ADD CONSTRAINT merchant_ad_connections_provider_check
  CHECK (provider IN ('google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads'));
ALTER TABLE public.merchant_ad_connections
  ADD COLUMN IF NOT EXISTS provider_account_label text,
  ADD COLUMN IF NOT EXISTS account_timezone text,
  ADD COLUMN IF NOT EXISTS attribution_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.merchant_ad_spend_daily
  DROP CONSTRAINT IF EXISTS merchant_ad_spend_daily_provider_check;
ALTER TABLE public.merchant_ad_spend_daily
  ADD CONSTRAINT merchant_ad_spend_daily_provider_check
  CHECK (provider IN ('google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads'));
ALTER TABLE public.merchant_ad_spend_daily
  ADD COLUMN IF NOT EXISTS spend_amount_decimal numeric(30, 9),
  ADD COLUMN IF NOT EXISTS reach bigint,
  ADD COLUMN IF NOT EXISTS account_timezone text,
  ADD COLUMN IF NOT EXISTS attribution_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.merchant_ad_spend_daily
  ADD CONSTRAINT merchant_ad_spend_daily_spend_amount_decimal_check
  CHECK (spend_amount_decimal IS NULL OR spend_amount_decimal >= 0);
ALTER TABLE public.merchant_ad_spend_daily
  ADD CONSTRAINT merchant_ad_spend_daily_reach_check
  CHECK (reach IS NULL OR reach >= 0);
ALTER TABLE public.merchant_ad_spend_daily
  ADD CONSTRAINT merchant_ad_spend_daily_currency_code_uppercase_check
  CHECK (currency_code = upper(currency_code));

CREATE INDEX IF NOT EXISTS merchant_ad_connections_merchant_provider_lookup_idx
  ON public.merchant_ad_connections (merchant_id, provider);
CREATE INDEX IF NOT EXISTS merchant_ad_spend_daily_merchant_provider_account_date_idx
  ON public.merchant_ad_spend_daily
    (merchant_id, provider, provider_customer_id, spend_date DESC);

CREATE OR REPLACE FUNCTION public.get_merchant_ads_connection_secret(
  p_merchant_id uuid,
  p_provider text
)
RETURNS TABLE (
  id uuid,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  provider_customer_id text,
  token_expires_at timestamptz,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    c.id,
    c.access_token_ciphertext,
    c.refresh_token_ciphertext,
    c.provider_customer_id,
    c.token_expires_at,
    c.status
  FROM public.merchant_ad_connections AS c
  WHERE c.merchant_id = p_merchant_id
    AND c.provider = p_provider
    AND p_provider IN ('google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads')
    AND public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
    );
$$;

CREATE OR REPLACE FUNCTION public.upsert_merchant_ads_connection(
  p_merchant_id uuid,
  p_provider text,
  p_access_token_ciphertext text,
  p_refresh_token_ciphertext text,
  p_provider_customer_id text,
  p_provider_account_label text,
  p_scopes text[],
  p_status text,
  p_token_expires_at timestamptz,
  p_account_timezone text,
  p_attribution_metadata jsonb,
  p_metadata jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN NULL;
  END IF;
  IF p_provider NOT IN ('google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads')
    OR p_status NOT IN ('active', 'disconnected', 'error')
    OR p_access_token_ciphertext !~ ('^v2\.' || p_provider || '\.[^.]+\.[^.]+\.[^.]+$')
    OR (p_refresh_token_ciphertext IS NOT NULL
      AND p_refresh_token_ciphertext !~ ('^v2\.' || p_provider || '\.[^.]+\.[^.]+\.[^.]+$'))
    OR (p_provider_customer_id IS NOT NULL
      AND (char_length(p_provider_customer_id) > 255 OR btrim(p_provider_customer_id) = ''))
    OR (p_provider_account_label IS NOT NULL AND char_length(p_provider_account_label) > 255)
    OR (p_account_timezone IS NOT NULL
      AND (char_length(p_account_timezone) > 128
        OR p_account_timezone !~ '^[A-Za-z_+/-]+$'))
    OR jsonb_typeof(COALESCE(p_attribution_metadata, '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM jsonb_object_keys(COALESCE(p_metadata, '{}'::jsonb)) AS key_name
      WHERE lower(key_name) ~ '(token|secret|credential|authorization)'
    ) THEN
    RAISE EXCEPTION 'invalid ads connection input';
  END IF;

  INSERT INTO public.merchant_ad_connections (
    merchant_id,
    provider,
    status,
    provider_customer_id,
    provider_account_label,
    access_token_ciphertext,
    refresh_token_ciphertext,
    token_expires_at,
    scopes,
    account_timezone,
    attribution_metadata,
    metadata
  ) VALUES (
    p_merchant_id,
    p_provider,
    p_status,
    NULLIF(btrim(p_provider_customer_id), ''),
    NULLIF(btrim(p_provider_account_label), ''),
    p_access_token_ciphertext,
    p_refresh_token_ciphertext,
    p_token_expires_at,
    COALESCE(p_scopes, ARRAY[]::text[]),
    NULLIF(btrim(p_account_timezone), ''),
    COALESCE(p_attribution_metadata, '{}'::jsonb),
    COALESCE(p_metadata, '{}'::jsonb)
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

CREATE OR REPLACE FUNCTION public.update_merchant_ads_connection_token(
  p_merchant_id uuid,
  p_provider text,
  p_access_token_ciphertext text,
  p_token_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN false;
  END IF;
  IF p_provider NOT IN ('google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads')
    OR p_access_token_ciphertext !~ ('^v2\.' || p_provider || '\.[^.]+\.[^.]+\.[^.]+$') THEN
    RAISE EXCEPTION 'invalid ads token input';
  END IF;
  UPDATE public.merchant_ad_connections
  SET access_token_ciphertext = p_access_token_ciphertext,
      token_expires_at = p_token_expires_at
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_merchant_ads_account(
  p_merchant_id uuid,
  p_provider text,
  p_provider_customer_id text,
  p_provider_account_label text,
  p_account_timezone text,
  p_attribution_metadata jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN false;
  END IF;
  IF p_provider NOT IN ('google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads')
    OR char_length(p_provider_customer_id) > 255
    OR btrim(p_provider_customer_id) = ''
    OR (p_provider_account_label IS NOT NULL AND char_length(p_provider_account_label) > 255)
    OR (p_account_timezone IS NOT NULL
      AND (char_length(p_account_timezone) > 128
        OR p_account_timezone !~ '^[A-Za-z_+/-]+$'))
    OR jsonb_typeof(COALESCE(p_attribution_metadata, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid ads account input';
  END IF;
  UPDATE public.merchant_ad_connections
  SET provider_customer_id = btrim(p_provider_customer_id),
      provider_account_label = NULLIF(btrim(p_provider_account_label), ''),
      account_timezone = NULLIF(btrim(p_account_timezone), ''),
      attribution_metadata = COALESCE(p_attribution_metadata, '{}'::jsonb)
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_merchant_ads_connection_synced(
  p_merchant_id uuid,
  p_provider text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) OR p_provider NOT IN ('google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads') THEN
    RETURN false;
  END IF;
  UPDATE public.merchant_ad_connections
  SET last_synced_at = now()
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_merchant_ads_connection(
  p_merchant_id uuid,
  p_provider text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) OR p_provider NOT IN ('google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads') THEN
    RETURN false;
  END IF;
  DELETE FROM public.merchant_ad_connections
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_merchant_ads_spend_daily(
  p_merchant_id uuid,
  p_provider text,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_selected_customer_id text;
  v_rows_written integer := 0;
  v_spend_amount_decimal text;
  v_fetched_at text;
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN 0;
  END IF;
  IF p_provider NOT IN ('google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads')
    OR jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) > 400 THEN
    RAISE EXCEPTION 'invalid ads spend rows';
  END IF;

  SELECT c.provider_customer_id
    INTO v_selected_customer_id
  FROM public.merchant_ad_connections AS c
  WHERE c.merchant_id = p_merchant_id
    AND c.provider = p_provider
    AND c.status = 'active';
  IF v_selected_customer_id IS NULL THEN
    RAISE EXCEPTION 'ads account is not selected';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_spend_amount_decimal := v_row ->> 'spend_amount_decimal';
    v_fetched_at := v_row ->> 'fetched_at';
    IF jsonb_typeof(v_row) <> 'object'
      OR COALESCE(v_row ->> 'provider_customer_id' <> v_selected_customer_id, true)
      OR COALESCE((v_row ->> 'spend_date') !~ '^\d{4}-\d{2}-\d{2}$', true)
      OR COALESCE((v_row ->> 'currency_code') !~ '^[A-Z]{3}$', true)
      OR COALESCE(v_spend_amount_decimal !~ '^\d+(\.\d{1,9})?$', true)
      OR COALESCE((v_row ->> 'spend_micros') !~ '^\d+$', true)
      OR COALESCE((v_row ->> 'impressions') !~ '^\d+$', true)
      OR COALESCE((v_row ->> 'clicks') !~ '^\d+$', true)
      OR COALESCE((v_row ->> 'conversions') !~ '^\d+(\.\d+)?$', true)
      OR COALESCE((v_row ->> 'reach') IS NOT NULL AND (v_row ->> 'reach') !~ '^\d+$', false)
      OR COALESCE((v_row ->> 'account_timezone') !~ '^[A-Za-z_+/-]+$', true)
      OR jsonb_typeof(COALESCE(v_row -> 'attribution_metadata', '{}'::jsonb)) <> 'object'
      OR COALESCE(v_fetched_at !~ '^\d{4}-\d{2}-\d{2}T', true) THEN
      RAISE EXCEPTION 'invalid ads spend row';
    END IF;

    INSERT INTO public.merchant_ad_spend_daily (
      merchant_id,
      provider,
      provider_customer_id,
      spend_date,
      currency_code,
      spend_micros,
      spend_amount_decimal,
      impressions,
      clicks,
      conversions,
      reach,
      account_timezone,
      attribution_metadata,
      fetched_at
    ) VALUES (
      p_merchant_id,
      p_provider,
      v_selected_customer_id,
      (v_row ->> 'spend_date')::date,
      v_row ->> 'currency_code',
      (v_row ->> 'spend_micros')::bigint,
      v_spend_amount_decimal::numeric,
      (v_row ->> 'impressions')::bigint,
      (v_row ->> 'clicks')::bigint,
      (v_row ->> 'conversions')::numeric,
      NULLIF(v_row ->> 'reach', '')::bigint,
      v_row ->> 'account_timezone',
      COALESCE(v_row -> 'attribution_metadata', '{}'::jsonb),
      v_fetched_at::timestamptz
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

REVOKE ALL ON FUNCTION public.get_merchant_ads_connection_secret(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_merchant_ads_connection(uuid, text, text, text, text, text, text[], text, timestamptz, text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_merchant_ads_connection_token(uuid, text, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_merchant_ads_account(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_merchant_ads_connection_synced(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_merchant_ads_connection(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_merchant_ads_spend_daily(uuid, text, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_merchant_ads_connection_secret(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_merchant_ads_connection(uuid, text, text, text, text, text, text[], text, timestamptz, text, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_merchant_ads_connection_token(uuid, text, text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_merchant_ads_account(uuid, text, text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_merchant_ads_connection_synced(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_merchant_ads_connection(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_merchant_ads_spend_daily(uuid, text, jsonb) TO authenticated, service_role;

REVOKE ALL ON TABLE public.merchant_ad_connections FROM authenticated;
GRANT SELECT (
  id,
  merchant_id,
  provider,
  status,
  provider_customer_id,
  provider_account_label,
  token_expires_at,
  scopes,
  last_synced_at,
  account_timezone,
  attribution_metadata,
  metadata,
  created_at,
  updated_at
) ON TABLE public.merchant_ad_connections TO authenticated;
REVOKE ALL ON TABLE public.merchant_ad_spend_daily FROM authenticated;
GRANT SELECT ON TABLE public.merchant_ad_spend_daily TO authenticated;

COMMIT;
