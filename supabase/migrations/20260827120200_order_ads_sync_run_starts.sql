-- Order refresh registrations so delayed chunks from an older loop cannot
-- reclaim a newer run's fence. The client creates one timestamp when a loop
-- starts and sends it with every chunk.

BEGIN;

ALTER TABLE public.merchant_ad_connections
  ADD COLUMN IF NOT EXISTS sync_run_started_at pg_catalog.timestamptz;

CREATE OR REPLACE FUNCTION public.clear_merchant_ads_sync_run_on_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.provider_customer_id IS DISTINCT FROM OLD.provider_customer_id
    OR NEW.status IS DISTINCT FROM OLD.status
  ) THEN
    NEW.sync_run_id := NULL;
    NEW.sync_run_started_at := NULL;
  ELSIF TG_OP = 'UPDATE' AND (
    NEW.access_token_ciphertext IS DISTINCT FROM OLD.access_token_ciphertext
    OR NEW.refresh_token_ciphertext IS DISTINCT FROM OLD.refresh_token_ciphertext
  ) THEN
    -- A token rotation invalidates the in-flight run identifier, but must not
    -- erase its ordering floor. A delayed older chunk therefore cannot reclaim
    -- the fence after this update; the current chunk rebinds at the same floor.
    NEW.sync_run_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.mark_merchant_ads_connection_sync_started_if_current(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.text, pg_catalog.uuid
);

CREATE OR REPLACE FUNCTION public.mark_merchant_ads_connection_sync_started_if_current(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_provider_customer_id pg_catalog.text,
  p_sync_run_id pg_catalog.uuid,
  p_sync_run_started_at pg_catalog.timestamptz
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
      last_synced_at = NULL
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
  p_sync_run_id pg_catalog.uuid
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_sync_run_id IS NULL
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
  pg_catalog.uuid, pg_catalog.text, pg_catalog.text,
  pg_catalog.uuid, pg_catalog.timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_merchant_ads_connection_sync_started_if_current(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.text,
  pg_catalog.uuid, pg_catalog.timestamptz
) TO authenticated, service_role;

COMMIT;
