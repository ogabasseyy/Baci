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
  IF p_expense_id IS NULL
     OR p_storage_path IS NULL
     OR p_storage_path !~ ('^expenses/' || p_merchant_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
     OR NOT EXISTS (
       SELECT 1
       FROM public.expenses AS e
       WHERE e.id = p_expense_id
         AND e.merchant_id = p_merchant_id
         AND position(
           '/object/public/media/' || p_storage_path IN e.receipt_url
         ) > 0
     ) THEN
    RAISE EXCEPTION 'Invalid legacy expense receipt path';
  END IF;

  IF NOT public.check_staff_permission(
    auth.uid(),
    p_merchant_id,
    'expenses',
    'edit'
  ) THEN
    RAISE EXCEPTION 'Not authorized to delete legacy expense receipts';
  END IF;

  DELETE FROM storage.objects
  WHERE bucket_id = 'media'
    AND name = p_storage_path;
  v_deleted := FOUND;
  UPDATE public.expenses AS e
  SET receipt_url = NULL
  WHERE e.id = p_expense_id
    AND e.merchant_id = p_merchant_id
    AND position('/object/public/media/' || p_storage_path IN e.receipt_url) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.expenses AS other_expense
      WHERE other_expense.receipt_url IS NOT NULL
        AND other_expense.id <> e.id
        AND position(
          '/object/public/media/' || p_storage_path IN other_expense.receipt_url
        ) > 0
    );
  RETURN v_deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_legacy_expense_receipt(uuid, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_legacy_expense_receipt(uuid, uuid, text)
  TO authenticated;
