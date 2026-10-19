-- Retain candidates until a trusted worker confirms Storage deletion.
-- The previous scheduler could discard the only reconciliation record.
CREATE OR REPLACE FUNCTION private.cleanup_legacy_expense_receipt_candidates(
  p_retention interval DEFAULT interval '30 days',
  p_limit integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_retention < interval '30 days' OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'Invalid legacy receipt cleanup retention arguments';
  END IF;

  RETURN 0;
END;
$function$;

REVOKE ALL ON FUNCTION private.cleanup_legacy_expense_receipt_candidates(interval, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.cleanup_legacy_expense_receipt_candidates(interval, integer)
  TO service_role;
