-- Keep audit actor foreign-key checks efficient as expenses grows.

CREATE INDEX IF NOT EXISTS idx_expenses_created_by_user_id
  ON public.expenses (created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_expenses_updated_by_user_id
  ON public.expenses (updated_by_user_id);

CREATE INDEX IF NOT EXISTS idx_expenses_group_id
  ON public.expenses (group_id);

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

DROP POLICY IF EXISTS expense_receipts_delete ON storage.objects;
CREATE POLICY expense_receipts_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (
      (
        CASE
          WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.check_staff_permission(
              (SELECT auth.uid()),
              (storage.foldername(name))[1]::uuid,
              'expenses',
              'edit'
            )
          ELSE false
        END
        AND NOT private.expense_receipt_is_referenced(name)
      )
      OR (
        CASE
          WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.check_staff_permission(
              (SELECT auth.uid()),
              (storage.foldername(name))[1]::uuid,
              'expenses',
              'create'
            )
          ELSE false
        END
        AND NOT private.expense_receipt_is_referenced(name)
        AND owner_id = (SELECT auth.uid())::text
      )
    )
  );
