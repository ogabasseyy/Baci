-- Record the date range covered by the last completed Ads refresh. The
-- timestamp on merchant_ad_connections is connection-wide, so it cannot by
-- itself prove that an empty dashboard window was fetched.

BEGIN;

ALTER TABLE public.merchant_ad_connections
  ADD COLUMN IF NOT EXISTS last_synced_start_date pg_catalog.date,
  ADD COLUMN IF NOT EXISTS last_synced_end_date pg_catalog.date;

ALTER TABLE public.merchant_ad_connections
  DROP CONSTRAINT IF EXISTS merchant_ad_connections_last_synced_window_bounds_check;
ALTER TABLE public.merchant_ad_connections
  ADD CONSTRAINT merchant_ad_connections_last_synced_window_bounds_check
  CHECK (
    (last_synced_start_date IS NULL AND last_synced_end_date IS NULL)
    OR (
      last_synced_start_date IS NOT NULL
      AND last_synced_end_date IS NOT NULL
      AND last_synced_start_date <= last_synced_end_date
    )
  );

-- The authenticated analytics projection is intentionally column-scoped;
-- explicitly add the non-secret completion bounds to that projection.
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
  last_synced_start_date,
  last_synced_end_date,
  account_timezone,
  attribution_metadata,
  metadata,
  created_at,
  updated_at
) ON TABLE public.merchant_ad_connections TO authenticated;

DROP FUNCTION IF EXISTS public.mark_merchant_ads_connection_sync_started_if_current(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.uuid,
  pg_catalog.timestamptz
);
DROP FUNCTION IF EXISTS public.mark_merchant_ads_connection_synced_if_current(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.uuid
);

CREATE OR REPLACE FUNCTION public.mark_merchant_ads_connection_sync_started_if_current(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_provider_customer_id pg_catalog.text,
  p_sync_run_id pg_catalog.uuid,
  p_sync_run_started_at pg_catalog.timestamptz,
  p_sync_window_start_date pg_catalog.date,
  p_sync_window_end_date pg_catalog.date
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_sync_run_id IS NULL
    OR p_sync_run_started_at IS NULL
    OR p_sync_run_started_at > pg_catalog.clock_timestamp()
      + pg_catalog.interval '5 minutes'
    OR p_sync_window_start_date IS NULL
    OR p_sync_window_end_date IS NULL
    OR p_sync_window_start_date > p_sync_window_end_date
    OR p_sync_window_end_date - p_sync_window_start_date >= 366
    OR NOT public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
    )
    OR p_provider NOT IN (
      'google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads'
    )
    OR p_provider_customer_id IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_provider_customer_id)) = 0
    OR pg_catalog.char_length(p_provider_customer_id) > 255 THEN
    RETURN false;
  END IF;

  UPDATE public.merchant_ad_connections
  SET sync_run_id = p_sync_run_id,
      sync_run_started_at = p_sync_run_started_at,
      last_synced_at = NULL,
      last_synced_start_date = NULL,
      last_synced_end_date = NULL
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider
    AND status = 'active'
    AND provider_customer_id = pg_catalog.btrim(p_provider_customer_id)
    AND (
      sync_run_started_at IS NULL
      OR p_sync_run_started_at > sync_run_started_at
      OR (
        p_sync_run_started_at = sync_run_started_at
        AND (
          sync_run_id = p_sync_run_id
          OR (sync_run_id IS NULL AND last_synced_at IS NULL)
        )
      )
    );
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_merchant_ads_connection_synced_if_current(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_provider_customer_id pg_catalog.text,
  p_sync_run_id pg_catalog.uuid,
  p_sync_window_start_date pg_catalog.date,
  p_sync_window_end_date pg_catalog.date
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_sync_run_id IS NULL
    OR p_sync_window_start_date IS NULL
    OR p_sync_window_end_date IS NULL
    OR p_sync_window_start_date > p_sync_window_end_date
    OR p_sync_window_end_date - p_sync_window_start_date >= 366
    OR NOT public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
    )
    OR p_provider NOT IN (
      'google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads'
    )
    OR p_provider_customer_id IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_provider_customer_id)) = 0
    OR pg_catalog.char_length(p_provider_customer_id) > 255 THEN
    RETURN false;
  END IF;

  UPDATE public.merchant_ad_connections
  SET last_synced_at = pg_catalog.now(),
      last_synced_start_date = p_sync_window_start_date,
      last_synced_end_date = p_sync_window_end_date,
      sync_run_id = NULL
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider
    AND status = 'active'
    AND provider_customer_id = pg_catalog.btrim(p_provider_customer_id)
    AND sync_run_id = p_sync_run_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_merchant_ads_connection_sync_started_if_current(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.uuid,
  pg_catalog.timestamptz,
  pg_catalog.date,
  pg_catalog.date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_merchant_ads_connection_sync_started_if_current(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.uuid,
  pg_catalog.timestamptz,
  pg_catalog.date,
  pg_catalog.date
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_merchant_ads_connection_synced_if_current(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.uuid,
  pg_catalog.date,
  pg_catalog.date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_merchant_ads_connection_synced_if_current(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.uuid,
  pg_catalog.date,
  pg_catalog.date
) TO authenticated, service_role;

COMMIT;
