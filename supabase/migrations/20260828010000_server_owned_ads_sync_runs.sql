-- Keep the ordering timestamp server-owned while allowing windowed refreshes
-- to reuse the timestamp registered by their first chunk.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_merchant_ads_sync_run_started_at(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_sync_run_id pg_catalog.uuid
)
RETURNS pg_catalog.timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.sync_run_started_at
  FROM public.merchant_ad_connections AS c
  WHERE c.merchant_id = p_merchant_id
    AND c.provider = p_provider
    AND p_provider IN (
      'google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads'
    )
    AND c.status = 'active'
    AND (
      c.sync_run_id = p_sync_run_id
      OR (
        c.sync_run_id IS NULL
        AND c.sync_run_started_at IS NOT NULL
        AND c.last_synced_at IS NULL
      )
    )
    AND public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
    );
$$;

REVOKE ALL ON FUNCTION public.get_merchant_ads_sync_run_started_at(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_merchant_ads_sync_run_started_at(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.uuid
) TO authenticated, service_role;

COMMIT;
