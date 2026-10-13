-- Schedule the authenticated worker only after its lifecycle RPCs exist.

BEGIN;

CREATE OR REPLACE FUNCTION private.invoke_scheduled_admin_notification_worker_v1()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_project_url text; v_service_role_key text; v_request_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'net')
    OR pg_catalog.to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_project_url FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_service_role_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF NULLIF(BTRIM(v_project_url), '') IS NULL OR NULLIF(BTRIM(v_service_role_key), '') IS NULL THEN RETURN NULL; END IF;
  SELECT net.http_post(
    url := v_project_url || '/functions/v1/process-scheduled-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role_key),
    body := '{}'::jsonb, timeout_milliseconds := 5000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$$;
REVOKE ALL ON FUNCTION private.invoke_scheduled_admin_notification_worker_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.invoke_scheduled_admin_notification_worker_v1() TO service_role;

COMMIT;

-- pg_cron runs outside the transaction. Missing cron, pg_net, Vault, or either
-- secret leaves delivery unscheduled rather than issuing an unsafe request.
DO $$
DECLARE
  v_project_url text;
  v_service_role_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'net')
    OR pg_catalog.to_regclass('vault.decrypted_secrets') IS NULL THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_service_role_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF NULLIF(BTRIM(v_project_url), '') IS NULL
    OR NULLIF(BTRIM(v_service_role_key), '') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-admin-notifications') THEN
    PERFORM cron.unschedule('process-scheduled-admin-notifications');
  END IF;
  PERFORM cron.schedule(
    'process-scheduled-admin-notifications',
    '* * * * *',
    'SELECT private.invoke_scheduled_admin_notification_worker_v1()'
  );
END;
$$;
