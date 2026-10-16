-- The terminal-cart purge is never scheduled by applying migrations:
-- activation is a separate, authorized step (see
-- docs/deploy/shared-cart-rollout.md), and an interrupted deployment
-- must not leave the destructive purge running. This migration only
-- removes any schedule created by an earlier draft of this step.
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
