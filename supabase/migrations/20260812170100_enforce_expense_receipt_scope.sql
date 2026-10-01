-- Enforce receipt ownership for new/changed paths without blocking legacy rows.

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_receipt_storage_path_scope;

CREATE OR REPLACE FUNCTION public.enforce_expense_receipt_storage_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.receipt_storage_path IS DISTINCT FROM OLD.receipt_storage_path THEN
    IF NEW.receipt_storage_path IS NOT NULL
       AND NEW.receipt_storage_path !~ (
         '^' || NEW.merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
       ) THEN
      RAISE EXCEPTION 'Expense receipt path is outside the merchant scope'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_expense_receipt_storage_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_expense_receipt_storage_scope() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_expense_receipt_storage_scope() FROM authenticated;

DROP TRIGGER IF EXISTS enforce_expenses_receipt_storage_scope ON public.expenses;
CREATE TRIGGER enforce_expenses_receipt_storage_scope
  BEFORE INSERT OR UPDATE OF receipt_storage_path ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_expense_receipt_storage_scope();
