-- Report missing scheduling support on disposable installations. If the
-- scheduler is available, require that the earlier migration installed the job.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE WARNING 'partner_unclaimed_quote_expiry scheduler unavailable';
  ELSIF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'partner-unclaimed-quote-expiry' AND active
      AND schedule = '22 * * * *'
      AND command = 'SELECT private.expire_unclaimed_partner_quotes();'
  ) THEN
    RAISE EXCEPTION 'partner_unclaimed_quote_expiry schedule missing';
  END IF;
END;
$$;
