-- Run only in an empty disposable PostgreSQL database, using psql from this
-- directory. Exercises the real production wrapper chain
-- (transaction-discount metadata -> date wrapper -> DVA advisory lock ->
-- item-edit stub); only the innermost item RPC, the payable refresh, and
-- the merchant timezone lookup are stubbed. Generated-date follow on
-- non-manual orders is owned by the pre-existing sync trigger and covered
-- by its own migration tests, so this harness has no document-date trigger.
-- Each mutating edit runs in its own DO block (one transaction per call,
-- like production) so the audit-merge assertions observe real boundaries.
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

-- Legacy omission must preserve the date and create no date audit entry.
DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_date_events integer;
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id, '{}'::jsonb);
  SELECT count(*) INTO v_date_events FROM order_audit_events
  WHERE order_id = v_id AND changed_fields @> ARRAY['transaction_date'];
  IF v_date_events <> 0 THEN
    RAISE EXCEPTION 'omitted date generated audit';
  END IF;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_result jsonb;
  v_events integer;
BEGIN
  v_result := public.update_admin_order_with_transaction_discount_metadata(v_id,
    '{"transaction_date":"2024-01-02T10:00:00Z"}');
  IF NOT (v_result -> 'changed_fields' @> '["transaction_date"]'::jsonb)
    OR NOT EXISTS (SELECT 1 FROM orders WHERE id = v_id
      AND transaction_date = '2024-01-02T10:00:00Z'
      AND created_at = '2026-01-01T10:00:00Z')
    OR NOT EXISTS (SELECT 1 FROM order_audit_events
      WHERE order_id = v_id
      AND changed_fields = ARRAY['transaction_date']
      AND before_snapshot -> 'transaction_date' = 'null'::jsonb
      AND (before_snapshot ->> 'effective_transaction_date')::timestamptz = '2026-01-01T10:00:00Z'
      AND after_snapshot ->> 'transaction_date' IS NOT NULL)
  THEN RAISE EXCEPTION 'backdate persistence/audit failed'; END IF;
  -- One save produces one audit record: the date fields merge into the
  -- delegated event instead of a second insert.
  SELECT count(*) INTO v_events FROM order_audit_events WHERE order_id = v_id;
  IF v_events <> 2 THEN
    RAISE EXCEPTION 'date correction was not merged into one audit event';
  END IF;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_date_events integer;
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id,
    '{"transaction_date":"2024-01-02T10:00:00Z"}');
  SELECT count(*) INTO v_date_events FROM order_audit_events
  WHERE order_id = v_id AND changed_fields @> ARRAY['transaction_date'];
  IF v_date_events <> 1 THEN
    RAISE EXCEPTION 'unchanged date generated audit';
  END IF;
END;
$$;

-- Manual orders move explicit document dates with the corrected day.
DO $$
DECLARE
  v_manual_id uuid := '55555555-5555-4555-8555-555555555555';
  v_result jsonb;
BEGIN
  v_result := public.update_admin_order_with_transaction_discount_metadata(
    v_manual_id,
    '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"2024-01-02"}');
  IF NOT (v_result -> 'changed_fields' @>
      '["transaction_date","invoice_issue_date","tax_point_date"]'::jsonb)
    OR NOT EXISTS (SELECT 1 FROM orders WHERE id = v_manual_id
      AND transaction_date = '2024-01-02T10:00:00Z'
      AND invoice_issue_date = '2024-01-02'
      AND invoice_issue_date_generated = false
      AND tax_point_date = '2024-01-02'
      AND tax_point_date_generated = false)
    OR NOT EXISTS (SELECT 1 FROM order_audit_events
      WHERE order_id = v_manual_id
      AND changed_fields =
        ARRAY['transaction_date','invoice_issue_date','tax_point_date']
      AND before_snapshot ->> 'invoice_issue_date' = '2024-05-01'
      AND after_snapshot ->> 'invoice_issue_date' = '2024-01-02'
      AND before_snapshot ->> 'tax_point_date' = '2024-05-01'
      AND after_snapshot ->> 'tax_point_date' = '2024-01-02')
  THEN RAISE EXCEPTION 'manual document date sync/audit failed'; END IF;
END;
$$;

-- The explicit device day wins over merchant-timezone derivation, so a
-- device ahead of the merchant near midnight keeps its picked day.
DO $$
DECLARE
  v_manual_id uuid := '55555555-5555-4555-8555-555555555555';
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_manual_id,
    '{"transaction_date":"2024-01-02T11:00:00Z","transaction_date_day":"2024-01-03"}');
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_manual_id
    AND invoice_issue_date = '2024-01-03'
    AND tax_point_date = '2024-01-03') THEN
    RAISE EXCEPTION 'explicit document day ignored';
  END IF;
END;
$$;

-- A lingering generated flag clears even when the date value already
-- matches, so the sync trigger cannot rewrite the device-selected day.
DO $$
DECLARE
  v_flag_id uuid := '66666666-6666-4666-8666-666666666666';
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_flag_id,
    '{"transaction_date":"2024-01-02T11:00:00Z","transaction_date_day":"2024-01-02"}');
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_flag_id
    AND invoice_issue_date_generated = false
    AND tax_point_date_generated = false)
    OR NOT EXISTS (SELECT 1 FROM order_audit_events
      WHERE order_id = v_flag_id
      AND changed_fields @>
        ARRAY['transaction_date','invoice_issue_date','tax_point_date'])
  THEN RAISE EXCEPTION 'generated flag not cleared'; END IF;
END;
$$;

-- Manual classification follows the post-edit channel: an online order
-- moved to physical in the same edit syncs its document dates.
DO $$
DECLARE
  v_src_id uuid := '77777777-7777-4777-8777-777777777777';
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_src_id,
    '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"2024-01-02","source":"physical"}');
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_src_id
    AND source = 'physical'
    AND invoice_issue_date = '2024-01-02'
    AND tax_point_date = '2024-01-02') THEN
    RAISE EXCEPTION 'post-edit source not used for manual sync';
  END IF;
END;
$$;

-- The reverse move skips the sync and preserves explicit document dates.
DO $$
DECLARE
  v_manual_id uuid := '55555555-5555-4555-8555-555555555555';
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_manual_id,
    '{"transaction_date":"2024-01-04T10:00:00Z","source":"online_store"}');
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_manual_id
    AND source = 'online_store'
    AND transaction_date = '2024-01-04T10:00:00Z'
    AND invoice_issue_date = '2024-01-03'
    AND tax_point_date = '2024-01-03')
    OR NOT EXISTS (SELECT 1 FROM order_audit_events
      WHERE order_id = v_manual_id
      AND changed_fields = ARRAY['transaction_date']
      AND after_snapshot ->> 'transaction_date' IS NOT NULL)
  THEN RAISE EXCEPTION 'reverse channel move mishandled'; END IF;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_bad jsonb;
BEGIN
  FOREACH v_bad IN ARRAY ARRAY[
    '{"transaction_date":"bad"}'::jsonb,
    '{"transaction_date":"2024-02-31T10:00:00Z"}'::jsonb,
    '{"transaction_date":"infinity"}'::jsonb,
    '{"transaction_date":null}'::jsonb,
    '{"transaction_date":123}'::jsonb,
    '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"01/02/2024"}'::jsonb,
    '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"2024-02-31"}'::jsonb,
    '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"2024-01-05"}'::jsonb,
    '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":123}'::jsonb,
    '{"transaction_date_day":"2024-01-02"}'::jsonb
  ] LOOP
    BEGIN
      PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id, v_bad);
      RAISE EXCEPTION 'invalid date accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN
      IF SQLERRM NOT LIKE '%order_date_invalid%'
        OR SQLERRM LIKE '%order_date_in_future%' THEN
        RAISE EXCEPTION 'malformed date code wrong: %', SQLERRM;
      END IF;
    END;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
BEGIN
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id,
      '{"transaction_date":"2999-01-01T10:00:00Z"}');
    RAISE EXCEPTION 'future date accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM NOT LIKE '%order_date_in_future%' THEN
      RAISE EXCEPTION 'future date code wrong: %', SQLERRM;
    END IF;
  END;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_events integer;
BEGIN
  SELECT count(*) INTO v_events FROM order_audit_events WHERE order_id = v_id;
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id,
      '{"transaction_date":"2023-01-01T10:00:00Z","fail":true}');
    RAISE EXCEPTION 'underlying failure swallowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'fixture_edit_failed' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_id
    AND transaction_date = '2024-01-02T10:00:00Z') THEN
    RAISE EXCEPTION 'failed edit changed date';
  END IF;
  IF (SELECT count(*) FROM order_audit_events WHERE order_id = v_id) <> v_events THEN
    RAISE EXCEPTION 'failed edit generated audit';
  END IF;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_events integer;
BEGIN
  UPDATE orders SET shipping_status = 'cancelled' WHERE id = v_id;
  SELECT count(*) INTO v_events FROM order_audit_events WHERE order_id = v_id;
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id,
      '{"transaction_date":"2023-01-01T10:00:00Z"}');
    RAISE EXCEPTION 'terminal order date edit accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM order_audit_events WHERE order_id = v_id) <> v_events THEN
    RAISE EXCEPTION 'terminal edit reached the delegate';
  END IF;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
BEGIN
  PERFORM set_config('test.actor', '', false);
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id, '{}'::jsonb);
    RAISE EXCEPTION 'unauthenticated edit accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL;
  END;

  PERFORM set_config('test.actor', '44444444-4444-4444-8444-444444444444', false);
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id,
      '{"transaction_date":"2023-01-01T10:00:00Z"}');
    RAISE EXCEPTION 'unauthorized date edit accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF has_function_privilege('authenticated',
    'public.update_admin_order_without_date(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'private delegate callable';
  END IF;
  IF has_function_privilege('authenticated',
    'public.update_admin_order(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'date wrapper callable';
  END IF;
END;
$$;

-- Standalone-insert fallback: when the delegate writes no audit event, the
-- date wrapper still records its own.
CREATE OR REPLACE FUNCTION public.update_admin_order_without_dva_balance_refresh(uuid, jsonb)
  RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN jsonb_build_object('order_id', $1, 'changed_fields', '[]'::jsonb,
    'change_category', 'internal');
END;
$$;
SET test.actor = '22222222-2222-4222-8222-222222222222';
DO $$
DECLARE
  v_id uuid := '88888888-8888-4888-8888-888888888888';
BEGIN
  INSERT INTO orders VALUES (
    v_id, '11111111-1111-4111-8111-111111111111',
    'online_store', '2024-05-01T10:00:00Z', '2024-05-01T10:00:00Z', NULL, 'pending',
    NULL, NULL, NULL, NULL, NULL
  );
  PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id,
    '{"transaction_date":"2024-06-01T10:00:00Z"}');
  IF NOT EXISTS (SELECT 1 FROM order_audit_events
    WHERE order_id = v_id
    AND changed_fields = ARRAY['transaction_date']
    AND actor_user_id = '22222222-2222-4222-8222-222222222222') THEN
    RAISE EXCEPTION 'standalone fallback insert missing';
  END IF;
END;
$$;
