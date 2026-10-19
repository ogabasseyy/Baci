-- Keep encrypted Google Ads grants behind bounded SECURITY DEFINER accessors.
-- The browser's authenticated role may read reporting metadata, but it must not
-- read ciphertext or mutate connections/spend rows around the route permission
-- checks. These RPCs re-derive the merchant and integrations permission from
-- auth.uid() before touching either table.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_google_ads_connection_secret(
  p_merchant_id uuid
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
SET search_path = public
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
    AND c.provider = 'google_ads'
    AND public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
    );
$$;

CREATE OR REPLACE FUNCTION public.upsert_google_ads_connection(
  p_merchant_id uuid,
  p_access_token_ciphertext text,
  p_refresh_token_ciphertext text,
  p_provider_customer_id text,
  p_scopes text[],
  p_status text,
  p_token_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN NULL;
  END IF;
  IF p_provider_customer_id IS NOT NULL
    AND p_provider_customer_id !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'invalid Google Ads customer id';
  END IF;
  IF p_status NOT IN ('active', 'disconnected', 'error') THEN
    RAISE EXCEPTION 'invalid Google Ads connection status';
  END IF;

  INSERT INTO public.merchant_ad_connections (
    merchant_id,
    provider,
    status,
    provider_customer_id,
    access_token_ciphertext,
    refresh_token_ciphertext,
    token_expires_at,
    scopes
  ) VALUES (
    p_merchant_id,
    'google_ads',
    p_status,
    p_provider_customer_id,
    p_access_token_ciphertext,
    p_refresh_token_ciphertext,
    p_token_expires_at,
    COALESCE(p_scopes, ARRAY[]::text[])
  )
  ON CONFLICT (merchant_id, provider) DO UPDATE SET
    status = EXCLUDED.status,
    provider_customer_id = EXCLUDED.provider_customer_id,
    access_token_ciphertext = EXCLUDED.access_token_ciphertext,
    refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
    token_expires_at = EXCLUDED.token_expires_at,
    scopes = EXCLUDED.scopes
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_google_ads_connection_token(
  p_merchant_id uuid,
  p_access_token_ciphertext text,
  p_token_expires_at timestamptz
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
  UPDATE public.merchant_ad_connections
  SET access_token_ciphertext = p_access_token_ciphertext,
      token_expires_at = p_token_expires_at
  WHERE merchant_id = p_merchant_id
    AND provider = 'google_ads';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_google_ads_connection_synced(
  p_merchant_id uuid
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
  UPDATE public.merchant_ad_connections
  SET last_synced_at = now()
  WHERE merchant_id = p_merchant_id
    AND provider = 'google_ads';
  RETURN FOUND;
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
  SET provider_customer_id = p_provider_customer_id
  WHERE merchant_id = p_merchant_id
    AND provider = 'google_ads';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_google_ads_connection(
  p_merchant_id uuid
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
  DELETE FROM public.merchant_ad_connections
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
      v_customer_id,
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

REVOKE ALL ON FUNCTION public.get_google_ads_connection_secret(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_google_ads_connection(uuid, text, text, text, text[], text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_google_ads_connection_token(uuid, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_google_ads_connection_synced(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_google_ads_customer(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_google_ads_connection(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_google_ads_spend_daily(uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_google_ads_connection_secret(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_google_ads_connection(uuid, text, text, text, text[], text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_google_ads_connection_token(uuid, text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_google_ads_connection_synced(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_google_ads_customer(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_google_ads_connection(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_google_ads_spend_daily(uuid, jsonb) TO authenticated, service_role;

-- Keep metadata readable through normal RLS selects, but hide ciphertext and
-- revoke all authenticated table DML so routes must pass the RPC guards above.
REVOKE ALL ON TABLE public.merchant_ad_connections FROM authenticated;
GRANT SELECT (
  id,
  merchant_id,
  provider,
  status,
  provider_customer_id,
  token_expires_at,
  scopes,
  last_synced_at,
  metadata,
  created_at,
  updated_at
) ON TABLE public.merchant_ad_connections TO authenticated;
REVOKE ALL ON TABLE public.merchant_ad_spend_daily FROM authenticated;
GRANT SELECT ON TABLE public.merchant_ad_spend_daily TO authenticated;

-- Defense in depth for direct PostgREST reads: merchant membership alone is
-- not enough to expose analytics rows to a staff member without the relevant
-- dashboard permission. Writes remain RPC-only for authenticated callers.
DROP POLICY IF EXISTS merchant_ad_connections_select ON public.merchant_ad_connections;
CREATE POLICY merchant_ad_connections_select
  ON public.merchant_ad_connections
  FOR SELECT TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'analytics', 'view'
    )
    OR public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'integrations', 'view'
    )
  );
DROP POLICY IF EXISTS merchant_ad_connections_insert ON public.merchant_ad_connections;
DROP POLICY IF EXISTS merchant_ad_connections_update ON public.merchant_ad_connections;
DROP POLICY IF EXISTS merchant_ad_connections_delete ON public.merchant_ad_connections;
DROP POLICY IF EXISTS merchant_ad_spend_daily_insert ON public.merchant_ad_spend_daily;
DROP POLICY IF EXISTS merchant_ad_spend_daily_update ON public.merchant_ad_spend_daily;
DROP POLICY IF EXISTS merchant_ad_spend_daily_select ON public.merchant_ad_spend_daily;
CREATE POLICY merchant_ad_spend_daily_select
  ON public.merchant_ad_spend_daily
  FOR SELECT TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'analytics', 'view'
    )
    OR public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'integrations', 'view'
    )
  );

COMMIT;
