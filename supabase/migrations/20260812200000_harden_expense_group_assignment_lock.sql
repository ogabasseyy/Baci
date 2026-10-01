-- Lock group assignment under the definer so create-only staff can insert
-- expenses without needing UPDATE permission on expense_groups.

CREATE OR REPLACE FUNCTION public.enforce_expense_group_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group_is_assignable boolean;
BEGIN
  IF NEW.group_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.group_id IS NOT DISTINCT FROM OLD.group_id) THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.expense_groups AS expense_group
    WHERE expense_group.id = NEW.group_id
      AND expense_group.merchant_id = NEW.merchant_id
      AND expense_group.archived_at IS NULL
      FOR UPDATE
  )
  INTO v_group_is_assignable;

  IF v_group_is_assignable IS NOT TRUE THEN
    RAISE EXCEPTION 'Invalid expense group assignment'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_expense_group_assignment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_expense_group_assignment() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_expense_group_assignment() FROM authenticated;
