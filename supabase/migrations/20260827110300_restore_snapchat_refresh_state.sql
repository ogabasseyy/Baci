-- A successful rotated Snapchat refresh must win over a stale reauth marker.
-- The refresh-token CAS makes this state transition safe for concurrent callers.

BEGIN;

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
      token_expires_at = p_token_expires_at,
      status = 'active',
      metadata = CASE
        WHEN metadata IS NULL THEN NULL
        ELSE metadata - 'reauthRequired' - 'reauthReason'
      END,
      attribution_metadata = CASE
        WHEN attribution_metadata IS NULL THEN NULL
        ELSE attribution_metadata - 'reauthRequired'
      END
  WHERE merchant_id = p_merchant_id
    AND provider = 'snapchat_ads'
    AND refresh_token_ciphertext = p_current_refresh_token_ciphertext;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.update_snapchat_ads_connection_tokens(
  uuid, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_snapchat_ads_connection_tokens(
  uuid, text, text, text, timestamptz
) TO service_role;

COMMIT;
