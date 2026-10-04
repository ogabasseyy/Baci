-- Run the worker-only credential cleanup inside Postgres. This keeps the
-- service-role-only RPC out of every web/API call graph.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname = 'jumia-orphan-authorization-sweep'
    ) THEN
      PERFORM cron.unschedule('jumia-orphan-authorization-sweep');
    END IF;

    PERFORM cron.schedule(
      'jumia-orphan-authorization-sweep',
      '17 * * * *',
      $cron$SELECT public.purge_orphaned_jumia_authorizations()$cron$
    );
  END IF;
END $$;
