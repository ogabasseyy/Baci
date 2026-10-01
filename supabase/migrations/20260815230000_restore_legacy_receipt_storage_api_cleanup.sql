-- Legacy receipt bytes must be removed through the Storage API worker, not metadata deletes.
-- Retains normalized path checks from 20260815210000_normalize_legacy_receipt_path_references.sql.

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

  RETURN false;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_legacy_expense_receipt(uuid, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_legacy_expense_receipt(uuid, uuid, text)
  TO authenticated;
