-- Preserve the last editor when a system operation has no authenticated actor.

CREATE OR REPLACE FUNCTION public.set_expense_actor_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := auth.uid();
    NEW.updated_by_user_id := auth.uid();
  ELSE
    IF auth.uid() IS NULL AND NEW.created_by_user_id IS NULL THEN
      NEW.created_by_user_id := NULL;
    ELSE
      NEW.created_by_user_id := OLD.created_by_user_id;
    END IF;
    IF auth.uid() IS NULL THEN
      NEW.updated_by_user_id := CASE
        WHEN NEW.updated_by_user_id IS NULL THEN NULL
        ELSE OLD.updated_by_user_id
      END;
    ELSE
      NEW.updated_by_user_id := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_expense_actor_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_expense_actor_columns() FROM anon;
REVOKE ALL ON FUNCTION public.set_expense_actor_columns() FROM authenticated;
