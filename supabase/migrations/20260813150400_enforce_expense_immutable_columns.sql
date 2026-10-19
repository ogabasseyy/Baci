-- Enforce immutability for server-owned identity and timestamp columns on expenses and expense_groups.

CREATE OR REPLACE FUNCTION public.prevent_expense_merchant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'expenses.id is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    RAISE EXCEPTION 'expenses.merchant_id is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'expenses.created_at is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_expense_merchant_change ON public.expenses;
CREATE TRIGGER prevent_expense_merchant_change
  BEFORE UPDATE OF id, merchant_id, created_at ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.prevent_expense_merchant_change();

CREATE OR REPLACE FUNCTION public.prevent_expense_group_merchant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'expense_groups.id is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    RAISE EXCEPTION 'expense_groups.merchant_id is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'expense_groups.created_at is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_expense_group_merchant_change ON public.expense_groups;
CREATE TRIGGER prevent_expense_group_merchant_change
  BEFORE UPDATE OF id, merchant_id, created_at ON public.expense_groups
  FOR EACH ROW EXECUTE FUNCTION public.prevent_expense_group_merchant_change();

REVOKE ALL ON FUNCTION public.prevent_expense_merchant_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_expense_merchant_change() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_expense_merchant_change() FROM authenticated;

REVOKE ALL ON FUNCTION public.prevent_expense_group_merchant_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_expense_group_merchant_change() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_expense_group_merchant_change() FROM authenticated;
