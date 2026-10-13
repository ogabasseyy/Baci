-- Compare normalized legacy receipt paths exactly instead of substring matching.

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

  DELETE FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
  WHERE candidate.storage_path !~ ('^expenses/' || candidate.merchant_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
     OR EXISTS (
       SELECT 1
       FROM public.expenses AS e
       WHERE e.receipt_url IS NOT NULL
         AND private.legacy_expense_receipt_storage_path_from_url(e.receipt_url)
           = candidate.storage_path
     );

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
          AND private.legacy_expense_receipt_storage_path_from_url(e.receipt_url)
            = candidate.storage_path
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

CREATE OR REPLACE FUNCTION public.authorize_legacy_expense_receipt_cleanup_deletion(
  p_expense_id uuid,
  p_merchant_id uuid,
  p_storage_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_expense_id IS NULL
     OR p_merchant_id IS NULL
     OR p_storage_path IS NULL
     OR p_storage_path !~ ('^expenses/' || p_merchant_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$') THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
  WHERE candidate.expense_id = p_expense_id
    AND candidate.merchant_id = p_merchant_id
    AND candidate.storage_path = p_storage_path
    AND candidate.claimed_at IS NOT NULL
    AND candidate.claimed_at >= now() - interval '10 minutes'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expenses AS expense
    WHERE expense.receipt_url IS NOT NULL
      AND private.legacy_expense_receipt_storage_path_from_url(expense.receipt_url)
        = p_storage_path
  ) THEN
    UPDATE private.expense_legacy_receipt_cleanup_candidates AS candidate
    SET claimed_at = NULL
    WHERE candidate.expense_id = p_expense_id
      AND candidate.merchant_id = p_merchant_id
      AND candidate.storage_path = p_storage_path;
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_legacy_expense_receipt(
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
  v_deleted boolean;
BEGIN
  IF p_expense_id IS NULL OR p_storage_path IS NULL
     OR p_storage_path !~ ('^expenses/' || p_merchant_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
     OR NOT EXISTS (
       SELECT 1 FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
       WHERE candidate.expense_id = p_expense_id
         AND candidate.merchant_id = p_merchant_id
         AND candidate.storage_path = p_storage_path
     ) THEN
    RAISE EXCEPTION 'Invalid legacy expense receipt path';
  END IF;

  IF NOT public.check_staff_permission(auth.uid(), p_merchant_id, 'expenses', 'edit') THEN
    RAISE EXCEPTION 'Not authorized to delete legacy expense receipts';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.expenses AS other_expense
    WHERE other_expense.receipt_url IS NOT NULL
      AND private.legacy_expense_receipt_storage_path_from_url(other_expense.receipt_url)
        = p_storage_path
  ) THEN
    RETURN false;
  END IF;

  DELETE FROM storage.objects
  WHERE bucket_id = 'media' AND name = p_storage_path;
  v_deleted := FOUND;
  IF v_deleted THEN
    DELETE FROM private.expense_legacy_receipt_cleanup_candidates
    WHERE expense_id = p_expense_id AND storage_path = p_storage_path;
  END IF;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_legacy_expense_receipt_cleanup_candidates(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_legacy_expense_receipt_cleanup_candidates(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.authorize_legacy_expense_receipt_cleanup_deletion(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_legacy_expense_receipt_cleanup_deletion(uuid, uuid, text)
  TO service_role;
