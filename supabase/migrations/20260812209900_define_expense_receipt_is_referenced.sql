-- Define the receipt reference helper before storage policies depend on it.

CREATE OR REPLACE FUNCTION private.expense_receipt_is_referenced(
  p_storage_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.expenses
    WHERE receipt_storage_path = p_storage_path
  );
$function$;

REVOKE ALL ON FUNCTION private.expense_receipt_is_referenced(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.expense_receipt_is_referenced(text) TO authenticated;
