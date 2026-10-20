-- Applying the migration chain must not, by itself, activate the
-- destructive terminal-cart purge: 20261015154000 scheduled it hourly
-- as soon as the migrations landed, which contradicts the gated
-- release (activation is a separate, authorized step). Unschedule the
-- job here; the activation step in docs/deploy/shared-cart-rollout.md
-- schedules it explicitly once retention is approved. Guarded on the
-- cron schema existing and re-runnable.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname = 'commerce-cart-terminal-purge'
    ) THEN
      PERFORM cron.unschedule('commerce-cart-terminal-purge');
    END IF;
  END IF;
END $$;
