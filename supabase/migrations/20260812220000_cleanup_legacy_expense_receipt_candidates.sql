-- Bound cleanup-candidate retention without giving client roles table access.

CREATE OR REPLACE FUNCTION private.cleanup_legacy_expense_receipt_candidates(
  p_retention interval DEFAULT interval '30 days',
  p_limit integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  IF p_retention < interval '30 days' OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'Invalid legacy receipt cleanup retention arguments';
  END IF;

  WITH expired AS (
    SELECT candidate.expense_id, candidate.storage_path
    FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
    WHERE candidate.created_at < now() - p_retention
    ORDER BY candidate.created_at
    LIMIT p_limit
  )
  DELETE FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
  USING expired
  WHERE candidate.expense_id = expired.expense_id
    AND candidate.storage_path = expired.storage_path;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION private.cleanup_legacy_expense_receipt_candidates(interval, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.cleanup_legacy_expense_receipt_candidates(interval, integer)
  TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname = 'legacy-expense-receipt-candidate-cleanup'
    ) THEN
      PERFORM cron.unschedule('legacy-expense-receipt-candidate-cleanup');
    END IF;
    PERFORM cron.schedule(
      'legacy-expense-receipt-candidate-cleanup',
      '37 * * * *',
      $cron$SELECT private.cleanup_legacy_expense_receipt_candidates()$cron$
    );
  END IF;
END $$;
