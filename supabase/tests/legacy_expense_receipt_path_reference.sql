-- Legacy receipt cleanup must compare normalized paths exactly, not by substring.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
VALUES (
  '2d6ed001-0000-4000-8000-00000000a001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'legacy-receipt-path-ref@example.test',
  'test',
  now(),
  now(),
  now(),
  '{}'::jsonb,
  '{}'::jsonb
);

SELECT pg_catalog.set_config(
  'app.audit_actor_user_id',
  '2d6ed001-0000-4000-8000-00000000a001',
  true
);

INSERT INTO public.merchants (
  id, user_id, email, business_name, business_type, country,
  payout_currency, slug, signup_source
)
VALUES (
  '2d6ed100-0000-4000-8000-00000000a001',
  '2d6ed001-0000-4000-8000-00000000a001',
  'legacy-receipt-path-ref-store@example.test',
  'Legacy Receipt Path Ref Store',
  'retail',
  'NG',
  'NGN',
  'legacy-receipt-path-ref-store',
  'web'
);

SELECT pg_catalog.set_config(
  'app.branch_audit_actor_id',
  '2d6ed001-0000-4000-8000-00000000a001',
  true
);

INSERT INTO public.branches (id, merchant_id, name, is_default, active)
VALUES (
  '2d6ed500-0000-4000-8000-00000000a001',
  '2d6ed100-0000-4000-8000-00000000a001',
  'Legacy receipt path ref default',
  true,
  true
);

INSERT INTO public.expenses (
  id,
  merchant_id,
  amount,
  category,
  date,
  receipt_url
)
VALUES (
  '2d6ed400-0000-4000-8000-00000000a010',
  '2d6ed100-0000-4000-8000-00000000a001',
  1000,
  'Operations',
  current_date,
  'https://project.supabase.co/storage/v1/object/public/media/expenses/2d6ed100-0000-4000-8000-00000000a001/receipt-10'
);

INSERT INTO private.expense_legacy_receipt_cleanup_candidates (
  expense_id,
  merchant_id,
  storage_path
)
VALUES (
  '2d6ed400-0000-4000-8000-00000000a011',
  '2d6ed100-0000-4000-8000-00000000a001',
  'expenses/2d6ed100-0000-4000-8000-00000000a001/receipt-1'
);

SELECT public.claim_legacy_expense_receipt_cleanup_candidates(10);

DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
    WHERE candidate.expense_id = '2d6ed400-0000-4000-8000-00000000a011'
      AND candidate.storage_path = 'expenses/2d6ed100-0000-4000-8000-00000000a001/receipt-1'
  ) THEN
    RAISE EXCEPTION 'prefix-similar live receipt must not block unrelated cleanup candidate';
  END IF;
END;
$assert$;

ROLLBACK;
