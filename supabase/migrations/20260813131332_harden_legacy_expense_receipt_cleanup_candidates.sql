-- Authorize cleanup from the captured pre-update candidate, never the current URL.
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
      AND position('/object/public/media/' || p_storage_path IN other_expense.receipt_url) > 0
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
