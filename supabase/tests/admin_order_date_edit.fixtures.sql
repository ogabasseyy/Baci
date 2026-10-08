-- Fixtures for admin_order_date_edit.sql: disposable roles, tables, stubs,
-- the real wrapper chain, and seed orders. Not a standalone check.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
  $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;
CREATE TABLE public.merchants (id uuid PRIMARY KEY, user_id uuid);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY, merchant_id uuid, source text,
  transaction_date timestamptz,
  created_at timestamptz, updated_at timestamptz, shipping_status text,
  invoice_issue_date date, invoice_issue_date_generated boolean,
  tax_point_date date, tax_point_date_generated boolean,
  ad_tracking jsonb
);
CREATE TABLE public.order_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  merchant_id uuid, order_id uuid, actor_user_id uuid, action text,
  change_category text, changed_fields text[], before_snapshot jsonb,
  after_snapshot jsonb, metadata jsonb
);
CREATE FUNCTION public.check_staff_permission(uuid, uuid, text, text)
  RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.manual_order_timezone(uuid)
  RETURNS text LANGUAGE sql AS $$ SELECT 'Africa/Lagos' $$;
CREATE FUNCTION public.refresh_paystack_order_payable_amount(uuid)
  RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;
-- Mirrors the real inner RPC: applies the channel change and always writes
-- one audit event, so the date wrapper exercises its merge path.
CREATE FUNCTION public.update_admin_order_without_dva_balance_refresh(uuid, jsonb)
  RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF $2 ? 'fail' THEN RAISE EXCEPTION 'fixture_edit_failed'; END IF;
  UPDATE public.orders
  SET source = COALESCE($2->>'source', source)
  WHERE id = $1;
  INSERT INTO public.order_audit_events (
    merchant_id, order_id, actor_user_id, action, change_category,
    changed_fields, before_snapshot, after_snapshot, metadata
  ) VALUES (
    (SELECT merchant_id FROM public.orders WHERE id = $1), $1,
    auth.uid(), 'order.update', 'internal', ARRAY[]::text[],
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  );
  RETURN jsonb_build_object('order_id', $1, 'changed_fields', '[]'::jsonb,
    'change_category', 'internal');
END;
$$;
\ir ../migrations/20260825151500_lock_admin_order_edit_before_dva_refresh.sql
\ir ../migrations/20260827110002_atomic_admin_order_transaction_discount_cleanup.sql
\ir ../migrations/20261008103000_allow_admin_order_date_edit.sql
\ir ../migrations/20261008185403_acquire_payment_lock_before_admin_order_edit.sql
INSERT INTO merchants VALUES (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);
INSERT INTO orders VALUES (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  NULL, NULL, '2026-01-01T10:00:00Z', NULL, 'pending',
  NULL, NULL, NULL, NULL, NULL
);
INSERT INTO orders VALUES (
  '55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  'manual', '2024-05-01T10:00:00Z', '2024-05-01T10:00:00Z', NULL, 'pending',
  '2024-05-01', false, '2024-05-01', false, NULL
);
INSERT INTO orders VALUES (
  '66666666-6666-4666-8666-666666666666',
  '11111111-1111-4111-8111-111111111111',
  'manual', '2024-05-01T10:00:00Z', '2024-05-01T10:00:00Z', NULL, 'pending',
  '2024-01-02', true, '2024-01-02', true, NULL
);
INSERT INTO orders VALUES (
  '77777777-7777-4777-8777-777777777777',
  '11111111-1111-4111-8111-111111111111',
  'online_store', '2024-05-01T10:00:00Z', '2024-05-01T10:00:00Z', NULL, 'pending',
  NULL, NULL, NULL, NULL, NULL
);
SET test.actor = '22222222-2222-4222-8222-222222222222';
