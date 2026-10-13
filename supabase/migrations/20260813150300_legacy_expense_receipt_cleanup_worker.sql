-- Trusted Storage API worker RPCs for legacy expense receipt byte cleanup.

ALTER TABLE private.expense_legacy_receipt_cleanup_candidates
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_legacy_expense_receipt_cleanup_candidates(
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  expense_id uuid,
  merchant_id uuid,
  storage_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Invalid legacy receipt cleanup batch limit';
  END IF;

  -- Discard candidates that are no longer valid (restored or referenced by any expense, or malformed path).
  DELETE FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
  WHERE candidate.storage_path !~ ('^expenses/' || candidate.merchant_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
     OR EXISTS (
       SELECT 1
       FROM public.expenses AS e
       WHERE e.receipt_url IS NOT NULL
         AND position('/object/public/media/' || candidate.storage_path IN e.receipt_url) > 0
     );

  -- Authorize and claim only candidates that are verified unreferenced.
  RETURN QUERY
  WITH to_claim AS (
    SELECT candidate.expense_id, candidate.merchant_id, candidate.storage_path
    FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
    WHERE (candidate.claimed_at IS NULL OR candidate.claimed_at < now() - interval '10 minutes')
      AND candidate.storage_path ~ ('^expenses/' || candidate.merchant_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
      AND NOT EXISTS (
        SELECT 1
        FROM public.expenses AS e
        WHERE e.receipt_url IS NOT NULL
          AND position('/object/public/media/' || candidate.storage_path IN e.receipt_url) > 0
      )
    ORDER BY candidate.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE private.expense_legacy_receipt_cleanup_candidates AS candidate
  SET claimed_at = now()
  FROM to_claim
  WHERE candidate.expense_id = to_claim.expense_id
    AND candidate.storage_path = to_claim.storage_path
  RETURNING candidate.expense_id, candidate.merchant_id, candidate.storage_path;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_legacy_expense_receipt_cleanup(
  p_expense_id uuid,
  p_merchant_id uuid,
  p_storage_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  IF p_expense_id IS NULL
     OR p_merchant_id IS NULL
     OR p_storage_path IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
  WHERE candidate.expense_id = p_expense_id
    AND candidate.merchant_id = p_merchant_id
    AND candidate.storage_path = p_storage_path;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_legacy_expense_receipt_cleanup_candidates(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_legacy_expense_receipt_cleanup_candidates(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_legacy_expense_receipt_cleanup(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_legacy_expense_receipt_cleanup(uuid, uuid, text)
  TO service_role;
