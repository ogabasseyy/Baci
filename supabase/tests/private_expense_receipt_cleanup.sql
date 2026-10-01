-- Private expense receipt cleanup claim and authorization contract.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
VALUES
  (
    '2d6ec001-0000-4000-8000-00000000b001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'private-receipt-owner@example.test',
    'test',
    now(),
    now(),
    now(),
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    '2d6ec001-0000-4000-8000-00000000b002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'private-receipt-creator@example.test',
    'test',
    now(),
    now(),
    now(),
    '{}'::jsonb,
    '{}'::jsonb
  );

SELECT pg_catalog.set_config(
  'app.audit_actor_user_id',
  '2d6ec001-0000-4000-8000-00000000b001',
  true
);

INSERT INTO public.merchants (
  id, user_id, email, business_name, business_type, country,
  payout_currency, slug, signup_source
)
VALUES (
  '2d6ec100-0000-4000-8000-00000000b001',
  '2d6ec001-0000-4000-8000-00000000b001',
  'private-receipt-store@example.test',
  'Private Receipt Store',
  'retail',
  'NG',
  'NGN',
  'private-receipt-store-contract',
  'web'
);

SELECT pg_catalog.set_config(
  'app.branch_audit_actor_id',
  '2d6ec001-0000-4000-8000-00000000b001',
  true
);

INSERT INTO public.branches (id, merchant_id, name, is_default, active)
VALUES (
  '2d6ec500-0000-4000-8000-00000000b001',
  '2d6ec100-0000-4000-8000-00000000b001',
  'Private receipt default',
  true,
  true
);

INSERT INTO public.staff_members (
  id, merchant_id, user_id, email, name, role, status, permissions
)
VALUES (
  '2d6ec200-0000-4000-8000-00000000b002',
  '2d6ec100-0000-4000-8000-00000000b001',
  '2d6ec001-0000-4000-8000-00000000b002',
  'private-receipt-creator@example.test',
  'Private Receipt Creator',
  'sales_rep',
  'active',
  '{"expenses":{"view":true,"create":true}}'::jsonb
);

INSERT INTO storage.objects (
  bucket_id, name, owner, owner_id, metadata
)
VALUES (
  'expense-receipts',
  '2d6ec100-0000-4000-8000-00000000b001/expenses/owned-receipt.jpg',
  '2d6ec001-0000-4000-8000-00000000b002',
  '2d6ec001-0000-4000-8000-00000000b002',
  '{}'::jsonb
),
(
  'expense-receipts',
  '2d6ec100-0000-4000-8000-00000000b001/expenses/foreign-receipt.jpg',
  '2d6ec001-0000-4000-8000-00000000b001',
  '2d6ec001-0000-4000-8000-00000000b001',
  '{}'::jsonb
);

INSERT INTO private.expense_private_receipt_cleanup_candidates (
  expense_id, merchant_id, storage_path, created_at
)
VALUES (
  NULL,
  '2d6ec100-0000-4000-8000-00000000b001',
  '2d6ec100-0000-4000-8000-00000000b001/expenses/fresh-upload.jpg',
  now()
);

DO $assert$
DECLARE
  v_claim_count integer;
BEGIN
  SELECT count(*)
    INTO v_claim_count
  FROM public.claim_expense_private_receipt_cleanup_candidates(10);

  IF v_claim_count <> 0 THEN
    RAISE EXCEPTION 'fresh private receipt cleanup candidates must not be claimed immediately';
  END IF;
END;
$assert$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '2d6ec001-0000-4000-8000-00000000b002',
  true
);

DO $assert$
BEGIN
  PERFORM public.queue_unreferenced_expense_private_receipt_cleanup(
    '2d6ec100-0000-4000-8000-00000000b001',
    '2d6ec100-0000-4000-8000-00000000b001/expenses/owned-receipt.jpg'
  );

  BEGIN
    PERFORM public.queue_unreferenced_expense_private_receipt_cleanup(
      '2d6ec100-0000-4000-8000-00000000b001',
      '2d6ec100-0000-4000-8000-00000000b001/expenses/foreign-receipt.jpg'
    );
    RAISE EXCEPTION 'create-only staff must not queue cleanup for another user''s upload';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Not authorized to queue unreferenced private expense receipt cleanup for this upload%' THEN
        RAISE;
      END IF;
  END;
END;
$assert$;

ROLLBACK;
