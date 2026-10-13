-- Editable merchant expense groups, audit actors, and receipt storage isolation.

CREATE TABLE IF NOT EXISTS public.expense_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS expense_groups_active_name_unique
  ON public.expense_groups (merchant_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expense_groups_merchant_id
  ON public.expense_groups (merchant_id);

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS group_id uuid
    REFERENCES public.expense_groups(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS vendor_name text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS receipt_storage_path text,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $receipt_scope$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.expenses'::regclass
      AND conname = 'expenses_receipt_storage_path_scope'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_receipt_storage_path_scope
      CHECK (
        receipt_storage_path IS NULL
        OR receipt_storage_path ~ (
          '^' || merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
        )
      ) NOT VALID;
  END IF;
END;
$receipt_scope$;

DO $constraints$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.expenses'::regclass
      AND conname = 'expenses_amount_positive'
  ) THEN
    ALTER TABLE public.expenses
      DROP CONSTRAINT expenses_amount_positive;
  END IF;

  ALTER TABLE public.expenses
    ADD CONSTRAINT expenses_amount_positive
    CHECK (
      amount > 0
      AND amount NOT IN (
        'NaN'::numeric,
        'Infinity'::numeric,
        '-Infinity'::numeric
      )
    ) NOT VALID;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.expenses'::regclass
      AND conname = 'expenses_vendor_name_length'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_vendor_name_length
      CHECK (vendor_name IS NULL OR char_length(btrim(vendor_name)) BETWEEN 1 AND 120);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.expenses'::regclass
      AND conname = 'expenses_payment_method_length'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_payment_method_length
      CHECK (payment_method IS NULL OR char_length(btrim(payment_method)) BETWEEN 1 AND 120);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.expenses'::regclass
      AND conname = 'expenses_reference_length'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_reference_length
      CHECK (reference IS NULL OR char_length(btrim(reference)) BETWEEN 1 AND 120);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.expenses'::regclass
      AND conname = 'expenses_description_length'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_description_length
      CHECK (description IS NULL OR char_length(description) <= 500) NOT VALID;
  END IF;
END;
$constraints$;

CREATE OR REPLACE FUNCTION public.enforce_expense_group_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.prevent_expense_merchant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    RAISE EXCEPTION 'expenses.merchant_id is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_expense_group_merchant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    RAISE EXCEPTION 'expense_groups.merchant_id is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_expense_actor_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := auth.uid();
  ELSIF auth.uid() IS NULL AND NEW.created_by_user_id IS NULL THEN
    NEW.created_by_user_id := NULL;
  ELSE
    NEW.created_by_user_id := OLD.created_by_user_id;
  END IF;

  NEW.updated_by_user_id := auth.uid();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_expense_group_assignment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_expense_group_assignment() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_expense_group_assignment() FROM authenticated;
REVOKE ALL ON FUNCTION public.prevent_expense_merchant_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_expense_merchant_change() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_expense_merchant_change() FROM authenticated;
REVOKE ALL ON FUNCTION public.prevent_expense_group_merchant_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_expense_group_merchant_change() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_expense_group_merchant_change() FROM authenticated;
REVOKE ALL ON FUNCTION public.set_expense_actor_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_expense_actor_columns() FROM anon;
REVOKE ALL ON FUNCTION public.set_expense_actor_columns() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM authenticated;

DROP TRIGGER IF EXISTS enforce_expense_group_assignment ON public.expenses;
CREATE TRIGGER enforce_expense_group_assignment
  BEFORE INSERT OR UPDATE OF merchant_id, group_id ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_expense_group_assignment();

DROP TRIGGER IF EXISTS prevent_expense_merchant_change ON public.expenses;
CREATE TRIGGER prevent_expense_merchant_change
  BEFORE UPDATE OF merchant_id ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.prevent_expense_merchant_change();

DROP TRIGGER IF EXISTS prevent_expense_group_merchant_change ON public.expense_groups;
CREATE TRIGGER prevent_expense_group_merchant_change
  BEFORE UPDATE OF merchant_id ON public.expense_groups
  FOR EACH ROW EXECUTE FUNCTION public.prevent_expense_group_merchant_change();

DROP TRIGGER IF EXISTS set_expense_actor_columns ON public.expenses;
CREATE TRIGGER set_expense_actor_columns
  BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_expense_actor_columns();

DROP TRIGGER IF EXISTS update_expenses_updated_at ON public.expenses;
CREATE TRIGGER update_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_expense_groups_updated_at ON public.expense_groups;
CREATE TRIGGER update_expense_groups_updated_at
  BEFORE UPDATE ON public.expense_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Merchants can manage their own expenses" ON public.expenses;
DROP POLICY IF EXISTS expense_staff_select ON public.expenses;
DROP POLICY IF EXISTS expense_staff_insert ON public.expenses;
DROP POLICY IF EXISTS expense_staff_update ON public.expenses;

CREATE POLICY expense_staff_select
  ON public.expenses
  FOR SELECT
  TO authenticated
  -- check_staff_permission grants merchant owners before staff permissions.
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'expenses',
      'view'
    )
  );

CREATE POLICY expense_staff_insert
  ON public.expenses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'expenses',
      'create'
    )
  );

CREATE POLICY expense_staff_update
  ON public.expenses
  FOR UPDATE
  TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'expenses',
      'edit'
    )
  )
  WITH CHECK (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'expenses',
      'edit'
    )
  );

DROP POLICY IF EXISTS expense_group_staff_select ON public.expense_groups;
DROP POLICY IF EXISTS expense_group_staff_insert ON public.expense_groups;
DROP POLICY IF EXISTS expense_group_staff_update ON public.expense_groups;

CREATE POLICY expense_group_staff_select
  ON public.expense_groups
  FOR SELECT
  TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'expenses',
      'view'
    )
  );

CREATE POLICY expense_group_staff_insert
  ON public.expense_groups
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'expenses',
      'edit'
    )
  );

CREATE POLICY expense_group_staff_update
  ON public.expense_groups
  FOR UPDATE
  TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'expenses',
      'edit'
    )
  )
  WITH CHECK (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'expenses',
      'edit'
    )
  );

REVOKE ALL ON TABLE public.expenses FROM PUBLIC;
REVOKE ALL ON TABLE public.expenses FROM anon;
REVOKE ALL ON TABLE public.expenses FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.expenses TO authenticated;
GRANT ALL ON TABLE public.expenses TO service_role;

REVOKE ALL ON TABLE public.expense_groups FROM PUBLIC;
REVOKE ALL ON TABLE public.expense_groups FROM anon;
REVOKE ALL ON TABLE public.expense_groups FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.expense_groups TO authenticated;
GRANT ALL ON TABLE public.expense_groups TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS expense_receipts_select ON storage.objects;
CREATE POLICY expense_receipts_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.check_staff_permission(
          (SELECT auth.uid()),
          (storage.foldername(name))[1]::uuid,
          'expenses',
          'view'
        )
      ELSE false
    END
  );

DROP POLICY IF EXISTS expense_receipts_insert ON storage.objects;
CREATE POLICY expense_receipts_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.check_staff_permission(
          (SELECT auth.uid()),
          (storage.foldername(name))[1]::uuid,
          'expenses',
          'create'
        )
        OR public.check_staff_permission(
          (SELECT auth.uid()),
          (storage.foldername(name))[1]::uuid,
          'expenses',
          'edit'
        )
      ELSE false
    END
  );

DROP POLICY IF EXISTS expense_receipts_delete ON storage.objects;
CREATE POLICY expense_receipts_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (
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
        AND owner_id = (SELECT auth.uid())::text
        AND NOT EXISTS (
          SELECT 1
          FROM public.expenses AS expense
          WHERE expense.receipt_storage_path = name
        )
      )
    )
  );

UPDATE public.role_permissions
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'::jsonb),
  '{expenses}',
  '{"view": true, "create": true, "edit": true}'::jsonb,
  true
)
WHERE role IN ('admin', 'manager', 'accountant');
