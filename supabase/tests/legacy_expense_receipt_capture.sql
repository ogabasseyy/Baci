-- Legacy expense receipt capture strips URL query data before queueing cleanup.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
VALUES (
  '2d6ec001-0000-4000-8000-00000000a001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'legacy-receipt-capture@example.test',
  'test',
  now(),
  now(),
  now(),
  '{}'::jsonb,
  '{}'::jsonb
);

SELECT pg_catalog.set_config(
  'app.audit_actor_user_id',
  '2d6ec001-0000-4000-8000-00000000a001',
  true
);

INSERT INTO public.merchants (
  id, user_id, email, business_name, business_type, country,
  payout_currency, slug, signup_source
)
VALUES (
  '2d6ec100-0000-4000-8000-00000000a001',
  '2d6ec001-0000-4000-8000-00000000a001',
  'legacy-receipt-store@example.test',
  'Legacy Receipt Store',
  'retail',
  'NG',
  'NGN',
  'legacy-receipt-store-contract',
  'web'
);

SELECT pg_catalog.set_config(
  'app.branch_audit_actor_id',
  '2d6ec001-0000-4000-8000-00000000a001',
  true
);

INSERT INTO public.branches (id, merchant_id, name, is_default, active)
VALUES (
  '2d6ec500-0000-4000-8000-00000000a001',
  '2d6ec100-0000-4000-8000-00000000a001',
  'Legacy receipt default',
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
  '2d6ec400-0000-4000-8000-00000000a001',
  '2d6ec100-0000-4000-8000-00000000a001',
  1500,
  'Operations',
  current_date,
  'https://project.supabase.co/storage/v1/object/public/media/expenses/2d6ec100-0000-4000-8000-00000000a001/receipt.jpg?download=1'
);

UPDATE public.expenses
SET receipt_url = NULL
WHERE id = '2d6ec400-0000-4000-8000-00000000a001';

DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
    WHERE candidate.expense_id = '2d6ec400-0000-4000-8000-00000000a001'
      AND candidate.storage_path = 'expenses/2d6ec100-0000-4000-8000-00000000a001/receipt.jpg'
  ) THEN
    RAISE EXCEPTION 'legacy receipt cleanup candidate was not captured without URL query data';
  END IF;
END;
$assert$;

ROLLBACK;
