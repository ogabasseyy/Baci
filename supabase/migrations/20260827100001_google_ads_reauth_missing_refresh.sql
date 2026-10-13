-- Legacy Google Ads rows may have no refresh grant. Allow the compare-and-set
-- reauthorization marker to match and clear those rows without fabricating a
-- credential value.

BEGIN;

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
    OR (p_refresh_token_ciphertext IS NOT NULL
      AND p_refresh_token_ciphertext !~ '^v1\.[^.]+\.[^.]+\.[^.]+$')
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

REVOKE ALL ON FUNCTION public.mark_google_ads_connection_reauth_if_current(
  uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_google_ads_connection_reauth_if_current(
  uuid, text, text, text
) TO service_role;

COMMIT;
