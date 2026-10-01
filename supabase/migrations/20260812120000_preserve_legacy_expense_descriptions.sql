-- Keep historical long descriptions editable while validating new values.

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_description_length;

CREATE OR REPLACE FUNCTION public.enforce_expense_description_length()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.description IS NOT NULL
     AND char_length(NEW.description) > 500
     AND (TG_OP = 'INSERT' OR NEW.description IS DISTINCT FROM OLD.description) THEN
    RAISE EXCEPTION 'Expense description must be 500 characters or fewer'
      USING ERRCODE = '22001';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_expense_description_length()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_expenses_description_length ON public.expenses;
CREATE TRIGGER enforce_expenses_description_length
  BEFORE INSERT OR UPDATE OF description ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_expense_description_length();
