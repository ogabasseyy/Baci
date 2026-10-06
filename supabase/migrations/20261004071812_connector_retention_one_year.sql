-- Connector metadata retention: one year, with a daily purge.
-- Audit rows contain grant id, route, status, and latency only. Grant rows
-- contain credential hashes and authorization metadata, never raw tokens.

CREATE INDEX IF NOT EXISTS idx_connector_grants_revoked_retention
  ON public.connector_grants (revoked_at)
  WHERE status = 'revoked';

CREATE INDEX IF NOT EXISTS idx_connector_grants_expired_retention
  ON public.connector_grants (expires_at)
  WHERE status IN ('active', 'expired') AND expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prune_connector_retention()
RETURNS TABLE (audit_rows_deleted bigint, grant_rows_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff timestamptz := pg_catalog.now() - interval '1 year';
BEGIN
  DELETE FROM public.connector_gateway_audit
  WHERE occurred_at < v_cutoff;
  GET DIAGNOSTICS audit_rows_deleted = ROW_COUNT;

  DELETE FROM public.connector_grants
  WHERE (
      status = 'revoked'
      AND coalesce(revoked_at, updated_at, created_at) < v_cutoff
    )
    OR (
      status IN ('active', 'expired')
      AND expires_at IS NOT NULL
      AND expires_at < v_cutoff
    );
  GET DIAGNOSTICS grant_rows_deleted = ROW_COUNT;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_connector_retention()
  FROM PUBLIC, anon, authenticated, connector_gateway;

-- pg_cron is already installed in the production project. Use the supported
-- scheduling function (same job name updates an existing schedule).
SELECT cron.schedule(
  'baci-connector-retention',
  '23 3 * * *',
  'SELECT public.prune_connector_retention();'
);
