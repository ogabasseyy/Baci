-- Delay first worker claims and restrict create-only unreferenced cleanup to owned uploads.

CREATE OR REPLACE FUNCTION public.queue_unreferenced_expense_private_receipt_cleanup(
  p_merchant_id uuid,
  p_storage_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_merchant_id IS NULL
     OR p_storage_path IS NULL
     OR p_storage_path !~ (
       '^' || p_merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
     ) THEN
    RETURN false;
  END IF;

  IF NOT (
    public.check_staff_permission(auth.uid(), p_merchant_id, 'expenses', 'edit')
    OR public.check_staff_permission(auth.uid(), p_merchant_id, 'expenses', 'create')
  ) THEN
    RAISE EXCEPTION 'Not authorized to queue unreferenced private expense receipt cleanup';
  END IF;

  IF NOT public.check_staff_permission(auth.uid(), p_merchant_id, 'expenses', 'edit')
     AND NOT EXISTS (
       SELECT 1
       FROM storage.objects AS object
       WHERE object.bucket_id = 'expense-receipts'
         AND object.name = p_storage_path
         AND object.owner_id = auth.uid()::text
     ) THEN
    RAISE EXCEPTION 'Not authorized to queue unreferenced private expense receipt cleanup for this upload';
  END IF;

  IF private.expense_receipt_is_referenced(p_storage_path) THEN
    RETURN false;
  END IF;

  INSERT INTO private.expense_private_receipt_cleanup_candidates (
    expense_id, merchant_id, storage_path
  )
  VALUES (NULL, p_merchant_id, p_storage_path)
  ON CONFLICT (merchant_id, storage_path) DO UPDATE
    SET created_at = now(),
        claimed_at = NULL;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_expense_private_receipt_cleanup_candidates(
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
    RAISE EXCEPTION 'Invalid private receipt cleanup batch limit';
  END IF;

  DELETE FROM private.expense_private_receipt_cleanup_candidates AS candidate
  WHERE candidate.storage_path !~ (
        '^' || candidate.merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
      )
     OR private.expense_receipt_is_referenced(candidate.storage_path);

  RETURN QUERY
  WITH to_claim AS (
    SELECT candidate.expense_id, candidate.merchant_id, candidate.storage_path
    FROM private.expense_private_receipt_cleanup_candidates AS candidate
    WHERE (candidate.claimed_at IS NULL OR candidate.claimed_at < now() - interval '10 minutes')
      AND candidate.created_at <= now() - interval '15 minutes'
      AND candidate.storage_path ~ (
        '^' || candidate.merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
      )
      AND NOT private.expense_receipt_is_referenced(candidate.storage_path)
    ORDER BY candidate.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE private.expense_private_receipt_cleanup_candidates AS candidate
  SET claimed_at = now()
  FROM to_claim
  WHERE candidate.merchant_id = to_claim.merchant_id
    AND candidate.storage_path = to_claim.storage_path
  RETURNING candidate.expense_id, candidate.merchant_id, candidate.storage_path;
END;
$function$;
