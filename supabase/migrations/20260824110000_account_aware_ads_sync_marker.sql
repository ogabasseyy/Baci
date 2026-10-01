-- Mark an ads connection fresh only when the account fetched by the sync is
-- still the active account selected for the merchant. The provider syncs read
-- the selected account before fetching; this compare-and-set marker prevents a
-- concurrent account switch from making the replacement account appear fresh.

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_merchant_ads_connection_synced_if_current(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_provider_customer_id pg_catalog.text
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  )
    OR p_provider NOT IN (
      'google_ads',
      'meta_ads',
      'tiktok_ads',
      'snapchat_ads'
    )
    OR p_provider_customer_id IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_provider_customer_id)) = 0
    OR pg_catalog.char_length(p_provider_customer_id) > 255 THEN
    RETURN false;
  END IF;

  UPDATE public.merchant_ad_connections
  SET last_synced_at = pg_catalog.now()
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider
    AND status = 'active'
    AND provider_customer_id = pg_catalog.btrim(p_provider_customer_id);
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_merchant_ads_connection_synced_if_current(
  uuid, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_merchant_ads_connection_synced_if_current(
  uuid, text, text
) TO authenticated, service_role;

COMMIT;
