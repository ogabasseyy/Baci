-- Preserve historical non-positive expense amounts while enforcing valid new edits.

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_amount_positive;

CREATE OR REPLACE FUNCTION public.enforce_expense_amount_positive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.amount IS DISTINCT FROM OLD.amount THEN
    IF NEW.amount <= 0
       OR NEW.amount IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
      RAISE EXCEPTION 'Expense amount must be a finite positive number'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_expense_amount_positive() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_expense_amount_positive() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_expense_amount_positive() FROM authenticated;

DROP TRIGGER IF EXISTS enforce_expenses_amount_positive ON public.expenses;
CREATE TRIGGER enforce_expenses_amount_positive
  BEFORE INSERT OR UPDATE OF amount ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_expense_amount_positive();
