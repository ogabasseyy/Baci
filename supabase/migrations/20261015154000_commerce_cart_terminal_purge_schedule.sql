-- Schedule the terminal-cart purge added in 20261015153000: without a
-- recurring caller the retention function would only run when an
-- operator happened to invoke it, and terminal carts would still grow
-- without bound. Hourly batches drain the backlog gradually. Guarded
-- on the cron schema existing (a no-op in environments without
-- pg_cron, e.g. a from-scratch replay) and re-runnable.
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
    PERFORM cron.schedule(
      'commerce-cart-terminal-purge',
      '37 * * * *',
      $cron$SELECT public.commerce_cart_purge_terminal_carts(interval '90 days', 500)$cron$
    );
  END IF;
END $$;
