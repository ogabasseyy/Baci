-- Expense editing and groups database contract.
-- This script deliberately creates fixtures inside one transaction and rolls
-- everything back so it can run against a shared local Supabase database.

BEGIN;

DO $contract$
DECLARE
  v_missing_column text;
  v_missing_function regprocedure;
  v_bucket_is_public boolean;
  v_bucket_file_size_limit bigint;
  v_bucket_allowed_mime_types text[];
BEGIN
  IF to_regclass('public.expense_groups') IS NULL THEN
    RAISE EXCEPTION 'expense_groups is missing';
  END IF;

  SELECT expected.column_name
    INTO v_missing_column
  FROM (
    VALUES
      ('group_id'),
      ('vendor_name'),
      ('payment_method'),
      ('reference'),
      ('receipt_storage_path'),
      ('created_by_user_id'),
      ('updated_by_user_id')
  ) AS expected(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.expenses'::regclass
      AND attribute.attname = expected.column_name
      AND NOT attribute.attisdropped
  )
  LIMIT 1;

  IF v_missing_column IS NOT NULL THEN
    RAISE EXCEPTION 'expenses.% is missing', v_missing_column;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_definition
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = constraint_definition.conrelid
      AND attribute.attnum = ANY (constraint_definition.conkey)
    WHERE constraint_definition.conrelid = 'public.expenses'::regclass
      AND constraint_definition.contype = 'f'
      AND attribute.attname = 'group_id'
      AND constraint_definition.confrelid = 'public.expense_groups'::regclass
  ) THEN
    RAISE EXCEPTION 'expenses.group_id must reference expense_groups';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_definition
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = constraint_definition.conrelid
      AND attribute.attnum = ANY (constraint_definition.conkey)
    WHERE constraint_definition.conrelid = 'public.expenses'::regclass
      AND constraint_definition.contype = 'f'
      AND attribute.attname IN ('created_by_user_id', 'updated_by_user_id')
      AND constraint_definition.confrelid = 'auth.users'::regclass
    GROUP BY constraint_definition.conrelid
    HAVING count(DISTINCT attribute.attname) = 2
  ) THEN
    RAISE EXCEPTION 'expense actor columns must reference auth.users';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS index_class
    JOIN pg_index AS index_definition ON index_definition.indexrelid = index_class.oid
    WHERE index_class.relname = 'expense_groups_active_name_unique'
      AND pg_get_expr(index_definition.indpred, index_definition.indrelid)
        ILIKE '%archived_at%is null%'
  ) THEN
    RAISE EXCEPTION 'expense_groups active-name uniqueness index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS index_class
    JOIN pg_index AS index_definition ON index_definition.indexrelid = index_class.oid
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = index_definition.indrelid
      AND attribute.attnum = ANY (index_definition.indkey)
    WHERE index_class.relname = 'idx_expense_groups_merchant_id'
      AND index_definition.indpred IS NULL
      AND attribute.attname = 'merchant_id'
  ) THEN
    RAISE EXCEPTION 'expense_groups merchant index is missing or partial';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS index_class
    WHERE index_class.relname = 'idx_expenses_merchant_group_date'
  ) THEN
    RAISE EXCEPTION 'expense merchant/group/date index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'idx_expenses_created_by_user_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'idx_expenses_updated_by_user_id'
  ) THEN
    RAISE EXCEPTION 'expense audit foreign-key indexes are missing';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint AS constraint_definition
    WHERE constraint_definition.conrelid = 'public.expenses'::regclass
      AND constraint_definition.conname IN (
        'expenses_vendor_name_length',
        'expenses_payment_method_length',
        'expenses_reference_length'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'expense validation constraints are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.expenses'::regclass
      AND tgname = 'enforce_expenses_description_length'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'legacy-safe expense description trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.expenses'::regclass
      AND tgname = 'enforce_expenses_amount_positive'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'legacy-safe expense amount trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.expenses'::regclass
      AND tgname = 'enforce_expenses_receipt_storage_scope'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'expense receipt scope trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.expenses'::regclass
      AND tgname = 'update_expenses_updated_at'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'expenses updated_at trigger is missing';
  END IF;

  IF to_regprocedure('private.expense_receipt_is_referenced(text)') IS NULL THEN
    RAISE EXCEPTION 'receipt reference helper is missing';
  END IF;


  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.expenses'::regclass
      AND tgname = 'ensure_expenses_branch_matches_merchant'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'existing expenses branch-integrity trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.expense_groups'::regclass
      AND tgname = 'update_expense_groups_updated_at'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'expense_groups updated_at trigger is missing';
  END IF;

  SELECT expected.function_signature::regprocedure
    INTO v_missing_function
  FROM (
    VALUES
      ('public.enforce_expense_group_assignment()'),
      ('public.prevent_expense_merchant_change()'),
      ('public.prevent_expense_group_merchant_change()'),
      ('public.set_expense_actor_columns()')
  ) AS expected(function_signature)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_definition
    WHERE procedure_definition.oid = expected.function_signature::regprocedure
      AND (
        expected.function_signature = 'public.enforce_expense_group_assignment()'
        OR procedure_definition.prosecdef IS FALSE
      )
      AND EXISTS (
        SELECT 1
        FROM unnest(COALESCE(procedure_definition.proconfig, ARRAY[]::text[]))
          AS configuration(setting)
        WHERE configuration.setting IN ('search_path=', 'search_path=""')
      )
  )
  LIMIT 1;

  IF v_missing_function IS NOT NULL THEN
    RAISE EXCEPTION 'expense trigger helper % must be SECURITY INVOKER with an empty search_path', v_missing_function;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_definition
    WHERE procedure_definition.oid IN (
      'public.enforce_expense_group_assignment()'::regprocedure,
      'public.prevent_expense_merchant_change()'::regprocedure,
      'public.prevent_expense_group_merchant_change()'::regprocedure,
      'public.set_expense_actor_columns()'::regprocedure
    )
      AND (
        EXISTS (
          SELECT 1
          FROM aclexplode(
            COALESCE(
              procedure_definition.proacl,
              acldefault('f', procedure_definition.proowner)
            )
          ) AS function_acl
          WHERE function_acl.grantee = 0
            AND function_acl.privilege_type = 'EXECUTE'
        )
        OR has_function_privilege('anon', procedure_definition.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', procedure_definition.oid, 'EXECUTE')
      )
  ) THEN
    RAISE EXCEPTION 'expense trigger helpers must not be directly executable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_definition
    WHERE procedure_definition.oid = 'public.update_updated_at_column()'::regprocedure
      AND (
        EXISTS (
          SELECT 1
          FROM aclexplode(
            COALESCE(
              procedure_definition.proacl,
              acldefault('f', procedure_definition.proowner)
            )
          ) AS function_acl
          WHERE function_acl.grantee = 0
            AND function_acl.privilege_type = 'EXECUTE'
        )
        OR has_function_privilege('anon', procedure_definition.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', procedure_definition.oid, 'EXECUTE')
      )
  ) THEN
    RAISE EXCEPTION 'update_updated_at_column must not be directly executable';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policy AS policy_definition
    WHERE policy_definition.polrelid = 'public.expenses'::regclass
      AND policy_definition.polname IN (
        'expense_staff_select',
        'expense_staff_insert',
        'expense_staff_update'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'expense view/create/edit policies are incomplete';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policy AS policy_definition
    WHERE policy_definition.polrelid = 'public.expense_groups'::regclass
      AND policy_definition.polname IN (
        'expense_group_staff_select',
        'expense_group_staff_insert',
        'expense_group_staff_update'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'expense group view/edit policies are incomplete';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_class
    WHERE oid IN (
      'public.expenses'::regclass,
      'public.expense_groups'::regclass
    )
      AND relrowsecurity
  ) <> 2 THEN
    RAISE EXCEPTION 'expense tables must keep row-level security enabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.expenses'::regclass AND polcmd = 'd'
  ) THEN
    RAISE EXCEPTION 'expenses must not expose a DELETE policy';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.expenses', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.expenses', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.expenses', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.expenses', 'DELETE')
     OR has_table_privilege('anon', 'public.expenses', 'SELECT')
     OR has_table_privilege('anon', 'public.expenses', 'INSERT')
     OR has_table_privilege('anon', 'public.expenses', 'UPDATE')
     OR has_table_privilege('anon', 'public.expenses', 'DELETE')
     OR has_table_privilege('anon', 'public.expense_groups', 'SELECT')
     OR has_table_privilege('anon', 'public.expense_groups', 'INSERT')
     OR has_table_privilege('anon', 'public.expense_groups', 'UPDATE')
     OR has_table_privilege('anon', 'public.expense_groups', 'DELETE') THEN
    RAISE EXCEPTION 'expense table grants are not least-privilege';
  END IF;

  SELECT bucket.public, bucket.file_size_limit, bucket.allowed_mime_types
    INTO v_bucket_is_public, v_bucket_file_size_limit, v_bucket_allowed_mime_types
  FROM storage.buckets
  AS bucket
  WHERE id = 'expense-receipts';

  IF NOT FOUND
     OR v_bucket_is_public
     OR v_bucket_file_size_limit <> 10485760
     OR v_bucket_allowed_mime_types IS DISTINCT FROM ARRAY[
       'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
     ]::text[] THEN
    RAISE EXCEPTION 'expense-receipts bucket is not private with the approved image-only 10 MB contract';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policy AS policy_definition
    WHERE policy_definition.polrelid = 'storage.objects'::regclass
      AND policy_definition.polname IN (
        'expense_receipts_select',
        'expense_receipts_insert',
        'expense_receipts_delete'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'expense receipt storage policies are incomplete';
  END IF;
END;
$contract$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
VALUES
  ('2d6ec001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'expense-owner-a@example.test', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('2d6ec001-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'expense-owner-b@example.test', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('2d6ec001-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'expense-view@example.test', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('2d6ec001-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'expense-create@example.test', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('2d6ec001-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'expense-edit@example.test', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('2d6ec001-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'expense-unrelated@example.test', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('2d6ec001-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'expense-admin@example.test', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('2d6ec001-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'expense-manager@example.test', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('2d6ec001-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'expense-accountant@example.test', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

SELECT pg_catalog.set_config(
  'app.audit_actor_user_id',
  '2d6ec001-0000-4000-8000-000000000001',
  true
);

INSERT INTO public.merchants (
  id, user_id, email, business_name, business_type, country,
  payout_currency, slug, signup_source
)
VALUES
  ('2d6ec100-0000-4000-8000-000000000001', '2d6ec001-0000-4000-8000-000000000001', 'expense-store-a@example.test', 'Expense Store A', 'retail', 'NG', 'NGN', 'expense-store-a-contract', 'web'),
  ('2d6ec100-0000-4000-8000-000000000002', '2d6ec001-0000-4000-8000-000000000002', 'expense-store-b@example.test', 'Expense Store B', 'retail', 'NG', 'NGN', 'expense-store-b-contract', 'web');

SELECT pg_catalog.set_config(
  'app.branch_audit_actor_id',
  '2d6ec001-0000-4000-8000-000000000001',
  true
);

INSERT INTO public.branches (id, merchant_id, name, is_default, active)
VALUES
  ('2d6ec500-0000-4000-8000-000000000001', '2d6ec100-0000-4000-8000-000000000001', 'Store A default', true, true),
  ('2d6ec500-0000-4000-8000-000000000002', '2d6ec100-0000-4000-8000-000000000002', 'Store B default', true, true);

INSERT INTO public.staff_members (
  id, merchant_id, user_id, email, name, role, status, permissions
)
VALUES
  ('2d6ec200-0000-4000-8000-000000000003', '2d6ec100-0000-4000-8000-000000000001', '2d6ec001-0000-4000-8000-000000000003', 'expense-view@example.test', 'Expense View', 'sales_rep', 'active', '{"expenses":{"view":true}}'::jsonb),
  ('2d6ec200-0000-4000-8000-000000000004', '2d6ec100-0000-4000-8000-000000000001', '2d6ec001-0000-4000-8000-000000000004', 'expense-create@example.test', 'Expense Create', 'sales_rep', 'active', '{"expenses":{"create":true},"custom_contract_sentinel":{"retained":true}}'::jsonb),
  ('2d6ec200-0000-4000-8000-000000000005', '2d6ec100-0000-4000-8000-000000000001', '2d6ec001-0000-4000-8000-000000000005', 'expense-edit@example.test', 'Expense Edit', 'sales_rep', 'active', '{"expenses":{"view":true,"edit":true}}'::jsonb),
  ('2d6ec200-0000-4000-8000-000000000007', '2d6ec100-0000-4000-8000-000000000001', '2d6ec001-0000-4000-8000-000000000007', 'expense-admin@example.test', 'Expense Admin', 'admin', 'active', '{}'::jsonb),
  ('2d6ec200-0000-4000-8000-000000000008', '2d6ec100-0000-4000-8000-000000000001', '2d6ec001-0000-4000-8000-000000000008', 'expense-manager@example.test', 'Expense Manager', 'manager', 'active', '{}'::jsonb),
  ('2d6ec200-0000-4000-8000-000000000009', '2d6ec100-0000-4000-8000-000000000001', '2d6ec001-0000-4000-8000-000000000009', 'expense-accountant@example.test', 'Expense Accountant', 'accountant', 'active', '{}'::jsonb);

INSERT INTO public.expense_groups (id, merchant_id, name)
VALUES
  ('2d6ec300-0000-4000-8000-000000000001', '2d6ec100-0000-4000-8000-000000000001', 'Active operations'),
  ('2d6ec300-0000-4000-8000-000000000002', '2d6ec100-0000-4000-8000-000000000001', 'Historical operations'),
  ('2d6ec300-0000-4000-8000-000000000003', '2d6ec100-0000-4000-8000-000000000002', 'Foreign operations');

INSERT INTO public.expenses (
  id, merchant_id, group_id, amount, category, description, date
)
VALUES (
  '2d6ec400-0000-4000-8000-000000000001',
  '2d6ec100-0000-4000-8000-000000000001',
  '2d6ec300-0000-4000-8000-000000000002',
  2500,
  'Operations',
  'Historical group assignment',
  current_date
);

UPDATE public.expense_groups
SET archived_at = now()
WHERE id = '2d6ec300-0000-4000-8000-000000000002';

DO $integrity$
BEGIN
  BEGIN
    INSERT INTO public.expenses (merchant_id, group_id, amount, category, date)
    VALUES (
      '2d6ec100-0000-4000-8000-000000000001',
      '2d6ec300-0000-4000-8000-000000000003',
      10,
      'Operations',
      current_date
    );
    RAISE EXCEPTION 'merchant-B group attached to merchant-A expense';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.expenses (merchant_id, group_id, amount, category, date)
    VALUES (
      '2d6ec100-0000-4000-8000-000000000001',
      '2d6ec300-0000-4000-8000-000000000002',
      10,
      'Operations',
      current_date
    );
    RAISE EXCEPTION 'new expense used an archived group';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  UPDATE public.expenses
  SET description = 'Historical group remains editable'
  WHERE id = '2d6ec400-0000-4000-8000-000000000001';

  BEGIN
    UPDATE public.expenses
    SET merchant_id = '2d6ec100-0000-4000-8000-000000000002'
    WHERE id = '2d6ec400-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expense merchant_id became mutable';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.expenses
    SET id = '2d6ec400-0000-4000-8000-000000000099'
    WHERE id = '2d6ec400-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expense id became mutable';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.expenses
    SET created_at = '2020-01-01 00:00:00+00'
    WHERE id = '2d6ec400-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expense created_at became mutable';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.expense_groups
    SET merchant_id = '2d6ec100-0000-4000-8000-000000000002'
    WHERE id = '2d6ec300-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expense group merchant_id became mutable';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.expense_groups
    SET id = '2d6ec300-0000-4000-8000-000000000099'
    WHERE id = '2d6ec300-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expense group id became mutable';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.expense_groups
    SET created_at = '2020-01-01 00:00:00+00'
    WHERE id = '2d6ec300-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expense group created_at became mutable';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.expenses
    SET branch_id = '2d6ec500-0000-4000-8000-000000000002'
    WHERE id = '2d6ec400-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'cross-merchant expense branch assignment succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.expense_groups (merchant_id, name)
    VALUES ('2d6ec100-0000-4000-8000-000000000001', ' active operations ');
    RAISE EXCEPTION 'active group names are not normalized as unique';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$integrity$;

DO $expense_amount_integrity$
DECLARE
  v_invalid_amount numeric;
BEGIN
  FOR v_invalid_amount IN
    SELECT candidate.amount
    FROM (
      VALUES
        ('NaN'::numeric),
        ('Infinity'::numeric),
        ('-Infinity'::numeric)
    ) AS candidate(amount)
  LOOP
    BEGIN
      INSERT INTO public.expenses (merchant_id, amount, category, date)
      VALUES (
        '2d6ec100-0000-4000-8000-000000000001',
        v_invalid_amount,
        'Operations',
        current_date
      );
      RAISE EXCEPTION 'expense insert accepted the non-finite amount %', v_invalid_amount;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;

    BEGIN
      UPDATE public.expenses
      SET amount = v_invalid_amount
      WHERE id = '2d6ec400-0000-4000-8000-000000000001';
      RAISE EXCEPTION 'expense update accepted the non-finite amount %', v_invalid_amount;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;
END;
$expense_amount_integrity$;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '2d6ec001-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"2d6ec001-0000-4000-8000-000000000003"}', true);
SET LOCAL ROLE authenticated;
DO $view_permission$
DECLARE
  v_group_count integer;
BEGIN
  IF NOT public.check_staff_permission(
    '2d6ec001-0000-4000-8000-000000000003',
    '2d6ec100-0000-4000-8000-000000000001',
    'expenses',
    'view'
  ) OR public.check_staff_permission(
    '2d6ec001-0000-4000-8000-000000000003',
    '2d6ec100-0000-4000-8000-000000000001',
    'expenses',
    'create'
  ) OR public.check_staff_permission(
    '2d6ec001-0000-4000-8000-000000000003',
    '2d6ec100-0000-4000-8000-000000000001',
    'expenses',
    'edit'
  ) THEN
    RAISE EXCEPTION 'view-only staff permission precedence is incorrect';
  END IF;

  SELECT count(*) INTO v_group_count
  FROM public.expense_groups;

  IF v_group_count <> 2 THEN
    RAISE EXCEPTION 'view staff cannot read archived expense groups';
  END IF;

  BEGIN
    INSERT INTO public.expenses (merchant_id, amount, category, date)
    VALUES ('2d6ec100-0000-4000-8000-000000000001', 10, 'Operations', current_date);
    RAISE EXCEPTION 'view-only staff created an expense';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.expense_groups (merchant_id, name)
    VALUES ('2d6ec100-0000-4000-8000-000000000001', 'View-only forbidden');
    RAISE EXCEPTION 'view-only staff created an expense group';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$view_permission$;
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '2d6ec001-0000-4000-8000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"2d6ec001-0000-4000-8000-000000000004"}', true);
SET LOCAL ROLE authenticated;
DO $create_permission$
DECLARE
  v_created_by uuid;
  v_updated_by uuid;
  v_updated_rows integer;
BEGIN
  IF NOT public.check_staff_permission(
    '2d6ec001-0000-4000-8000-000000000004',
    '2d6ec100-0000-4000-8000-000000000001',
    'expenses',
    'create'
  ) OR public.check_staff_permission(
    '2d6ec001-0000-4000-8000-000000000004',
    '2d6ec100-0000-4000-8000-000000000001',
    'expenses',
    'edit'
  ) THEN
    RAISE EXCEPTION 'create-only staff permission precedence is incorrect';
  END IF;

  INSERT INTO public.expenses (
    id, merchant_id, group_id, amount, category, receipt_storage_path, date
  ) VALUES (
    '2d6ec400-0000-4000-8000-000000000004',
    '2d6ec100-0000-4000-8000-000000000001',
    '2d6ec300-0000-4000-8000-000000000001',
    99,
    'Operations',
    '2d6ec100-0000-4000-8000-000000000001/expenses/saved-receipt.png',
    current_date
  ) RETURNING created_by_user_id, updated_by_user_id INTO v_created_by, v_updated_by;

  IF v_created_by <> '2d6ec001-0000-4000-8000-000000000004'
     OR v_updated_by <> '2d6ec001-0000-4000-8000-000000000004' THEN
    RAISE EXCEPTION 'expense insert actor columns do not come from auth.uid()';
  END IF;

  UPDATE public.expenses
  SET vendor_name = 'Create-only cannot edit'
  WHERE id = '2d6ec400-0000-4000-8000-000000000004';
  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows <> 0 THEN
    RAISE EXCEPTION 'create-only staff edited an expense';
  END IF;

  IF (
    SELECT count(*)
    FROM public.expense_groups
    WHERE merchant_id = '2d6ec100-0000-4000-8000-000000000001'
      AND archived_at IS NULL
  ) = 0 THEN
    RAISE EXCEPTION 'create-only staff cannot read assignable expense groups';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expense_groups
    WHERE merchant_id = '2d6ec100-0000-4000-8000-000000000001'
      AND archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'create-only staff can read archived expense groups';
  END IF;
END;
$create_permission$;
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '2d6ec001-0000-4000-8000-000000000005', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"2d6ec001-0000-4000-8000-000000000005"}', true);
SET LOCAL ROLE authenticated;
DO $edit_permission$
DECLARE
  v_created_by uuid;
  v_updated_by uuid;
  v_updated_at timestamptz;
BEGIN
  IF NOT public.check_staff_permission(
    '2d6ec001-0000-4000-8000-000000000005',
    '2d6ec100-0000-4000-8000-000000000001',
    'expenses',
    'edit'
  ) OR public.check_staff_permission(
    '2d6ec001-0000-4000-8000-000000000005',
    '2d6ec100-0000-4000-8000-000000000001',
    'expenses',
    'create'
  ) THEN
    RAISE EXCEPTION 'edit-only staff permission precedence is incorrect';
  END IF;

  INSERT INTO public.expense_groups (merchant_id, name)
  VALUES ('2d6ec100-0000-4000-8000-000000000001', 'Edit-created group');

  UPDATE public.expenses
  SET vendor_name = 'Edited vendor',
      created_by_user_id = '2d6ec001-0000-4000-8000-000000000006',
      updated_at = '2000-01-01 00:00:00+00'
  WHERE id = '2d6ec400-0000-4000-8000-000000000004'
  RETURNING created_by_user_id, updated_by_user_id, updated_at
    INTO v_created_by, v_updated_by, v_updated_at;

  IF v_created_by <> '2d6ec001-0000-4000-8000-000000000004'
     OR v_updated_by <> '2d6ec001-0000-4000-8000-000000000005'
     OR v_updated_at = '2000-01-01 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'expense updates must preserve creator, stamp editor, and own updated_at';
  END IF;

END;
$edit_permission$;
RESET ROLE;

DO $system_actor$
DECLARE
  v_updated_by uuid;
BEGIN
  UPDATE public.expenses
  SET vendor_name = 'System update'
  WHERE id = '2d6ec400-0000-4000-8000-000000000004'
  RETURNING updated_by_user_id INTO v_updated_by;
  IF v_updated_by <> '2d6ec001-0000-4000-8000-000000000005' THEN
    RAISE EXCEPTION 'system updates must preserve the last editor';
  END IF;
END;
$system_actor$;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '2d6ec001-0000-4000-8000-000000000007', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"2d6ec001-0000-4000-8000-000000000007"}', true);
SET LOCAL ROLE authenticated;
DO $admin_default$
BEGIN
  IF NOT public.check_staff_permission('2d6ec001-0000-4000-8000-000000000007', '2d6ec100-0000-4000-8000-000000000001', 'expenses', 'view')
     OR NOT public.check_staff_permission('2d6ec001-0000-4000-8000-000000000007', '2d6ec100-0000-4000-8000-000000000001', 'expenses', 'create')
     OR NOT public.check_staff_permission('2d6ec001-0000-4000-8000-000000000007', '2d6ec100-0000-4000-8000-000000000001', 'expenses', 'edit') THEN
    RAISE EXCEPTION 'admin defaults lack expense permissions';
  END IF;
END;
$admin_default$;
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '2d6ec001-0000-4000-8000-000000000008', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"2d6ec001-0000-4000-8000-000000000008"}', true);
SET LOCAL ROLE authenticated;
DO $manager_default$
BEGIN
  IF NOT public.check_staff_permission('2d6ec001-0000-4000-8000-000000000008', '2d6ec100-0000-4000-8000-000000000001', 'expenses', 'view')
     OR NOT public.check_staff_permission('2d6ec001-0000-4000-8000-000000000008', '2d6ec100-0000-4000-8000-000000000001', 'expenses', 'create')
     OR NOT public.check_staff_permission('2d6ec001-0000-4000-8000-000000000008', '2d6ec100-0000-4000-8000-000000000001', 'expenses', 'edit') THEN
    RAISE EXCEPTION 'manager defaults lack expense permissions';
  END IF;
END;
$manager_default$;
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '2d6ec001-0000-4000-8000-000000000009', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"2d6ec001-0000-4000-8000-000000000009"}', true);
SET LOCAL ROLE authenticated;
DO $accountant_default$
BEGIN
  IF NOT public.check_staff_permission('2d6ec001-0000-4000-8000-000000000009', '2d6ec100-0000-4000-8000-000000000001', 'expenses', 'view')
     OR NOT public.check_staff_permission('2d6ec001-0000-4000-8000-000000000009', '2d6ec100-0000-4000-8000-000000000001', 'expenses', 'create')
     OR NOT public.check_staff_permission('2d6ec001-0000-4000-8000-000000000009', '2d6ec100-0000-4000-8000-000000000001', 'expenses', 'edit') THEN
    RAISE EXCEPTION 'accountant defaults lack expense permissions';
  END IF;
END;
$accountant_default$;
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '2d6ec001-0000-4000-8000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"2d6ec001-0000-4000-8000-000000000004"}', true);
SET LOCAL ROLE authenticated;
DO $storage_create$
DECLARE
  v_rows integer;
BEGIN
  PERFORM pg_catalog.set_config('storage.allow_delete_query', 'true', true);

  IF (SELECT public.get_staff_permissions('2d6ec200-0000-4000-8000-000000000004') -> 'custom_contract_sentinel' ->> 'retained') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'custom staff permissions were overwritten';
  END IF;

  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
  VALUES (
    'expense-receipts',
    '2d6ec100-0000-4000-8000-000000000001/expenses/saved-receipt.png',
    '2d6ec001-0000-4000-8000-000000000004',
    '{"mimetype":"image/png","size":1}'::jsonb
  );

  DELETE FROM storage.objects
  WHERE bucket_id = 'expense-receipts'
    AND name = '2d6ec100-0000-4000-8000-000000000001/expenses/saved-receipt.png';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'create-only staff deleted a receipt still referenced by an expense';
  END IF;

  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
  VALUES (
    'expense-receipts',
    '2d6ec100-0000-4000-8000-000000000001/expenses/create-only-orphan.png',
    '2d6ec001-0000-4000-8000-000000000004',
    '{"mimetype":"image/png","size":1}'::jsonb
  );

  DELETE FROM storage.objects
  WHERE bucket_id = 'expense-receipts'
    AND name = '2d6ec100-0000-4000-8000-000000000001/expenses/create-only-orphan.png';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'create-only staff could not clean up its own unreferenced upload';
  END IF;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES (
      'expense-receipts',
      '2d6ec100-0000-4000-8000-000000000002/expenses/wrong-merchant.png',
      '2d6ec001-0000-4000-8000-000000000004',
      '{"mimetype":"image/png","size":1}'::jsonb
    );
    RAISE EXCEPTION 'create staff uploaded outside its merchant folder';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$storage_create$;
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '2d6ec001-0000-4000-8000-000000000005', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"2d6ec001-0000-4000-8000-000000000005"}', true);
SET LOCAL ROLE authenticated;
DO $storage_edit$
DECLARE
  v_rows integer;
BEGIN
  PERFORM pg_catalog.set_config('storage.allow_delete_query', 'true', true);

  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
  VALUES (
    'expense-receipts',
    '2d6ec100-0000-4000-8000-000000000001/expenses/replacement-receipt.png',
    '2d6ec001-0000-4000-8000-000000000005',
    '{"mimetype":"image/png","size":1}'::jsonb
  );

  UPDATE public.expenses
  SET receipt_storage_path = '2d6ec100-0000-4000-8000-000000000001/expenses/replacement-receipt.png'
  WHERE id = '2d6ec400-0000-4000-8000-000000000004';

  DELETE FROM storage.objects
  WHERE bucket_id = 'expense-receipts'
    AND name = '2d6ec100-0000-4000-8000-000000000001/expenses/saved-receipt.png';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'edit staff could not remove a replaced receipt';
  END IF;
END;
$storage_edit$;
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '2d6ec001-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"2d6ec001-0000-4000-8000-000000000003"}', true);
SET LOCAL ROLE authenticated;
DO $storage_view$
DECLARE
  v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows
  FROM storage.objects
  WHERE bucket_id = 'expense-receipts'
    AND name = '2d6ec100-0000-4000-8000-000000000001/expenses/replacement-receipt.png';

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'view staff cannot read/sign a merchant receipt';
  END IF;
END;
$storage_view$;
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '2d6ec001-0000-4000-8000-000000000006', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"2d6ec001-0000-4000-8000-000000000006"}', true);
SET LOCAL ROLE authenticated;
DO $storage_unrelated$
DECLARE
  v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows
  FROM storage.objects
  WHERE bucket_id = 'expense-receipts';

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'unrelated authenticated user read expense receipts';
  END IF;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES (
      'expense-receipts',
      '2d6ec100-0000-4000-8000-000000000001/expenses/unrelated-write.png',
      '2d6ec001-0000-4000-8000-000000000006',
      '{"mimetype":"image/png","size":1}'::jsonb
    );
    RAISE EXCEPTION 'unrelated authenticated user wrote an expense receipt';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$storage_unrelated$;
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $storage_anon$
DECLARE
  v_rows integer;
BEGIN
  BEGIN
    SELECT count(*) INTO v_rows
    FROM storage.objects
    WHERE bucket_id = 'expense-receipts';

    IF v_rows <> 0 THEN
      RAISE EXCEPTION 'anon read expense receipts';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'expense-receipts',
      '2d6ec100-0000-4000-8000-000000000001/expenses/anon-write.png',
      '{"mimetype":"image/png","size":1}'::jsonb
    );
    RAISE EXCEPTION 'anon wrote an expense receipt';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$storage_anon$;
RESET ROLE;

ROLLBACK;
