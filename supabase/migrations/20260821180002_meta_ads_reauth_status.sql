-- Fail-closed Meta Ads credential lifecycle marker. This deliberately does
-- not expose or accept any token ciphertext, and does not broaden the generic
-- social-provider write surface.

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_merchant_ads_connection_reauth(
  p_merchant_id pg_catalog.uuid,
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
  ) OR p_reason NOT IN ('META_ADS_REAUTH_REQUIRED', 'META_ADS_ACCESS_REVOKED') THEN
    RETURN false;
  END IF;

  UPDATE public.merchant_ad_connections
  SET
    status = 'error',
    token_expires_at = NULL,
    metadata = pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        COALESCE(metadata, '{}'::pg_catalog.jsonb),
        '{reauthRequired}',
        'true'::pg_catalog.jsonb,
        true
      ),
      '{reauthReason}',
      pg_catalog.to_jsonb(p_reason),
      true
    )
  WHERE merchant_id = p_merchant_id
    AND provider = 'meta_ads';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_merchant_ads_connection_reauth(pg_catalog.uuid, pg_catalog.text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_merchant_ads_connection_reauth(pg_catalog.uuid, pg_catalog.text) TO authenticated, service_role;

COMMIT;
