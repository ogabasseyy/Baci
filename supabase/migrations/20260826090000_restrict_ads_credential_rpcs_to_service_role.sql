-- Keep Ads credential material behind the server-only boundary.
--
-- The original Ads RPCs were permission-checked for an authenticated user,
-- but were also executable through PostgREST. A staff member who can manage
-- two merchants could therefore read one merchant's ciphertext and submit it
-- to another merchant's connection RPC. The API routes now authenticate and
-- resolve the selected merchant before using their branded service client.
-- These RPCs retain the authenticated permission check as a defense-in-depth
-- fallback, but their ACL is service_role-only so browsers cannot invoke them.

BEGIN;

CREATE OR REPLACE FUNCTION public.ads_credential_rpc_authorized(
  p_merchant_id pg_catalog.uuid
)
RETURNS pg_catalog.bool
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role'
    OR public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
    );
$$;

REVOKE ALL ON FUNCTION public.ads_credential_rpc_authorized(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_google_ads_connection_secret(
  p_merchant_id pg_catalog.uuid
)
RETURNS TABLE (
  id pg_catalog.uuid,
  access_token_ciphertext pg_catalog.text,
  refresh_token_ciphertext pg_catalog.text,
  provider_customer_id pg_catalog.text,
  token_expires_at pg_catalog.timestamptz,
  status pg_catalog.text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
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
    AND public.ads_credential_rpc_authorized(p_merchant_id);
$$;

CREATE OR REPLACE FUNCTION public.upsert_google_ads_connection(
  p_merchant_id pg_catalog.uuid,
  p_access_token_ciphertext pg_catalog.text,
  p_refresh_token_ciphertext pg_catalog.text,
  p_provider_customer_id pg_catalog.text,
  p_scopes pg_catalog.text[],
  p_status pg_catalog.text,
  p_token_expires_at pg_catalog.timestamptz
)
RETURNS pg_catalog.uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id pg_catalog.uuid;
BEGIN
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
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
    COALESCE(p_scopes, ARRAY[]::pg_catalog.text[])
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
  p_merchant_id pg_catalog.uuid,
  p_access_token_ciphertext pg_catalog.text,
  p_token_expires_at pg_catalog.timestamptz
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
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
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
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

CREATE OR REPLACE FUNCTION public.set_google_ads_customer(
  p_merchant_id pg_catalog.uuid,
  p_provider_customer_id pg_catalog.text,
  p_expected_access_token_ciphertext pg_catalog.text
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
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
    AND provider = 'google_ads'
    AND access_token_ciphertext IS NOT DISTINCT FROM p_expected_access_token_ciphertext;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_google_ads_connection_reauth_if_current(
  p_merchant_id pg_catalog.uuid,
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
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
    RETURN false;
  END IF;
  IF (p_access_token_ciphertext IS NOT NULL
      AND p_access_token_ciphertext !~ '^v1\.[^.]+\.[^.]+\.[^.]+$')
    OR p_refresh_token_ciphertext IS NULL
    OR p_refresh_token_ciphertext !~ '^v1\.[^.]+\.[^.]+\.[^.]+$'
    OR pg_catalog.char_length(p_reason) > 128
    OR p_reason !~ '^[A-Za-z0-9_.-]+$' THEN
    RAISE EXCEPTION 'invalid Google Ads reauth input';
  END IF;

  UPDATE public.merchant_ad_connections
  SET status = 'error',
      provider_customer_id = NULL,
      last_synced_at = NULL,
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
    AND provider = 'google_ads'
    AND access_token_ciphertext IS NOT DISTINCT FROM p_access_token_ciphertext
    AND refresh_token_ciphertext IS NOT DISTINCT FROM p_refresh_token_ciphertext;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_google_ads_connection(
  p_merchant_id pg_catalog.uuid
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
    RETURN false;
  END IF;
  DELETE FROM public.merchant_ad_connections
  WHERE merchant_id = p_merchant_id
    AND provider = 'google_ads';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_merchant_ads_connection_secret(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text
)
RETURNS TABLE (
  id pg_catalog.uuid,
  access_token_ciphertext pg_catalog.text,
  refresh_token_ciphertext pg_catalog.text,
  provider_customer_id pg_catalog.text,
  token_expires_at pg_catalog.timestamptz,
  status pg_catalog.text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
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
    AND p_provider IN ('meta_ads', 'tiktok_ads', 'snapchat_ads')
    AND public.ads_credential_rpc_authorized(p_merchant_id);
$$;

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
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
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

CREATE OR REPLACE FUNCTION public.update_merchant_ads_connection_token(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_access_token_ciphertext pg_catalog.text,
  p_token_expires_at pg_catalog.timestamptz
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
    RETURN false;
  END IF;
  IF p_provider NOT IN ('meta_ads', 'tiktok_ads', 'snapchat_ads')
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
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
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
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
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

CREATE OR REPLACE FUNCTION public.delete_merchant_ads_connection(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
    RETURN false;
  END IF;
  IF p_provider NOT IN ('meta_ads', 'tiktok_ads', 'snapchat_ads') THEN
    RETURN false;
  END IF;
  DELETE FROM public.merchant_ad_connections
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_snapchat_ads_connection_tokens(
  p_merchant_id pg_catalog.uuid,
  p_current_refresh_token_ciphertext pg_catalog.text,
  p_access_token_ciphertext pg_catalog.text,
  p_refresh_token_ciphertext pg_catalog.text,
  p_token_expires_at pg_catalog.timestamptz
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
    RETURN false;
  END IF;
  IF p_current_refresh_token_ciphertext !~ '^v2\.snapchat_ads\.[^.]+\.[^.]+\.[^.]+$'
    OR p_access_token_ciphertext !~ '^v2\.snapchat_ads\.[^.]+\.[^.]+\.[^.]+$'
    OR p_refresh_token_ciphertext !~ '^v2\.snapchat_ads\.[^.]+\.[^.]+\.[^.]+$' THEN
    RETURN false;
  END IF;

  UPDATE public.merchant_ad_connections
  SET access_token_ciphertext = p_access_token_ciphertext,
      refresh_token_ciphertext = p_refresh_token_ciphertext,
      token_expires_at = p_token_expires_at
  WHERE merchant_id = p_merchant_id
    AND provider = 'snapchat_ads'
    AND refresh_token_ciphertext = p_current_refresh_token_ciphertext;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_snapchat_ads_connection_and_spend(
  p_merchant_id pg_catalog.uuid
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_connection_deleted pg_catalog.bool := false;
BEGIN
  IF NOT public.ads_credential_rpc_authorized(p_merchant_id) THEN
    RETURN false;
  END IF;

  DELETE FROM public.merchant_ad_spend_daily
  WHERE merchant_id = p_merchant_id
    AND provider = 'snapchat_ads';

  DELETE FROM public.merchant_ad_connections
  WHERE merchant_id = p_merchant_id
    AND provider = 'snapchat_ads';
  v_connection_deleted := FOUND;
  RETURN v_connection_deleted;
END;
$$;

-- Credential-returning, ciphertext-accepting, and credential-deletion RPCs
-- are server-only. The old overloads remain revoked by their existing
-- migrations; the explicit signatures below cover every active overload.
REVOKE ALL ON FUNCTION public.get_google_ads_connection_secret(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_google_ads_connection(
  uuid, text, text, text, text[], text, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_google_ads_connection_token(
  uuid, text, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_google_ads_connection_token_if_current(
  uuid, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_google_ads_customer(
  uuid, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_google_ads_connection_reauth_if_current(
  uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_google_ads_connection(uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_merchant_ads_connection_secret(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_merchant_ads_connection(
  uuid, text, text, text, text, text, text[], text, timestamptz,
  text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_merchant_ads_connection_token(
  uuid, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_merchant_ads_account(
  uuid, text, text, text, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_merchant_ads_connection_reauth_if_current(
  uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_merchant_ads_connection(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_snapchat_ads_connection_tokens(
  uuid, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_snapchat_ads_connection_and_spend(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_google_ads_connection_secret(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_google_ads_connection(
  uuid, text, text, text, text[], text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_google_ads_connection_token(
  uuid, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_google_ads_connection_token_if_current(
  uuid, text, text, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_google_ads_customer(
  uuid, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_google_ads_connection_reauth_if_current(
  uuid, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_google_ads_connection(uuid)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.get_merchant_ads_connection_secret(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_merchant_ads_connection(
  uuid, text, text, text, text, text, text[], text, timestamptz,
  text, jsonb, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_merchant_ads_connection_token(
  uuid, text, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_merchant_ads_account(
  uuid, text, text, text, text, jsonb, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_merchant_ads_connection_reauth_if_current(
  uuid, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_merchant_ads_connection(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_snapchat_ads_connection_tokens(
  uuid, text, text, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_snapchat_ads_connection_and_spend(uuid)
  TO service_role;

COMMENT ON FUNCTION public.ads_credential_rpc_authorized(uuid) IS
  'Internal Ads credential guard: service_role only at the RPC boundary; authenticated permission checks remain defense in depth for trusted internal calls.';

COMMIT;
