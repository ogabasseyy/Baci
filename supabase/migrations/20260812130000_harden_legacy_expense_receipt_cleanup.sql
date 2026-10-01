-- Delete only a legacy receipt captured from the expense being updated.

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
  IF p_expense_id IS NULL
     OR p_storage_path IS NULL
     OR p_storage_path !~ ('^expenses/' || p_merchant_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
     OR NOT EXISTS (
       SELECT 1
       FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
       WHERE candidate.expense_id = p_expense_id
         AND candidate.merchant_id = p_merchant_id
         AND candidate.storage_path = p_storage_path
     ) THEN
    RAISE EXCEPTION 'Invalid legacy expense receipt path';
  END IF;

  IF NOT public.check_staff_permission(
    auth.uid(), p_merchant_id, 'expenses', 'edit'
  ) THEN
    RAISE EXCEPTION 'Not authorized to delete legacy expense receipts';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.expenses AS target_expense
    WHERE target_expense.id = p_expense_id
      AND target_expense.merchant_id = p_merchant_id
      AND (
        target_expense.receipt_url IS NULL
        OR position(
          '/object/public/media/' || p_storage_path
          IN target_expense.receipt_url
        ) = 0
      )
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expenses AS other_expense
    WHERE other_expense.id <> p_expense_id
      AND other_expense.receipt_url IS NOT NULL
      AND position(
        '/object/public/media/' || p_storage_path IN other_expense.receipt_url
      ) > 0
  ) THEN
    RETURN false;
  END IF;

  -- Storage bytes must be removed through the Storage API/trusted worker.
  -- Keep the candidate until that worker confirms deletion; deleting the
  -- metadata row directly would falsely report cleanup while leaving bytes.
  RETURN false;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_legacy_expense_receipt(uuid, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_legacy_expense_receipt(uuid, uuid, text)
  TO authenticated;
