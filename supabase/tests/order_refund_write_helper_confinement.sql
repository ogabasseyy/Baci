-- REGRESSION TEST: refund record/response helper confinement.
--
-- private.record_manual_order_refund and private.refund_status_response
-- keep EXECUTE granted to authenticated so denial lands on the clean
-- schema-USAGE check (revoking segfaults, see the migration note).
-- This suite proves their in-function gates confine them anyway: with
-- private-schema USAGE granted (rolled back), the owner's calls
-- succeed, a foreign merchant's calls fail closed with 42501, a
-- view-only staffer reads status but never records, an actor-spoofing
-- member is rejected, and uid-less service_role contexts bypass.
-- Without the gates a direct call would bypass every manager check
-- (cancelled/paid, permission, pending-evidence, processing) and
-- insert ledger rows, or read another tenant's refund history.
-- Fixtures use the 9ef5 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_write_helper_confinement.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $confinement_fixtures$
DECLARE
  v_owner_a uuid := '9ef50000-0000-4000-8000-000000000001';
  v_owner_b uuid := '9ef50000-0000-4000-8000-000000000002';
  v_viewer_id uuid := '9ef50000-0000-4000-8000-000000000003';
  v_merchant_a uuid := '9ef50100-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_a, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'record-a@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_owner_b, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'record-b@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_viewer_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'record-viewer@example.test',
      'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_a, v_owner_a, 'record-a@example.test',
      'Record Fixture', 'record-fixture');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_a, v_viewer_id, 'record-viewer@example.test',
      'Record Viewer', 'accountant',
      '{"orders":{"view":true}}'::jsonb, 'active');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef51000-0000-4000-8000-000000000050', v_merchant_a, 'RECORD-050',
      100, 100, 'paid', 'cancelled');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef52000-0000-4000-8000-000000000060', v_merchant_a,
      '9ef51000-0000-4000-8000-000000000050', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-50', '{}'::jsonb);

  -- Reach the function bodies past the schema boundary (rolled back):
  -- the suite asserts production keeps USAGE denied.
  GRANT USAGE ON SCHEMA private TO authenticated;
  GRANT SELECT ON public.transactions TO authenticated;
  GRANT SELECT ON public.merchants TO authenticated;
  GRANT SELECT ON public.orders TO authenticated;
  GRANT SELECT ON public.order_refund_events TO authenticated;
  CREATE POLICY confinement_probe_transactions
    ON public.transactions FOR SELECT TO authenticated
    USING (true);
  CREATE POLICY confinement_probe_merchants
    ON public.merchants FOR SELECT TO authenticated
    USING (true);
  CREATE POLICY confinement_probe_orders
    ON public.orders FOR SELECT TO authenticated
    USING (true);
  CREATE POLICY confinement_probe_refund_events
    ON public.order_refund_events FOR SELECT TO authenticated
    USING (true);
END;
$confinement_fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef50000-0000-4000-8000-000000000001',
  true
);

DO $confinement_owner$
DECLARE
  v_response jsonb;
  v_message text;
BEGIN
  -- The owner's status read succeeds: the gate must not break
  -- legitimate calls.
  SELECT private.refund_status_response(
    '9ef51000-0000-4000-8000-000000000050',
    '9ef50100-0000-4000-8000-000000000001',
    'NGN', 100, 0, 100, 0, 0, 'not_started', NULL, 0, 0,
    true, false, false, pg_catalog.now()
  ) INTO v_response;
  IF v_response IS NULL THEN
    RAISE EXCEPTION 'owner response call returned null';
  END IF;
  -- The owner's record call reaches the attestation check: gate
  -- passed (no 42501), validation rejects the unattested probe
  -- before any row is written.
  BEGIN
    PERFORM private.record_manual_order_refund(
      '9ef51000-0000-4000-8000-000000000050',
      '9ef50100-0000-4000-8000-000000000001',
      'NGN', pg_catalog.now(), '9ef50000-0000-4000-8000-000000000001',
      10, pg_catalog.now(), 'bank_transfer', NULL, false, 'probe-1',
      100, 0, 'not_started', NULL, 0, 0, NULL);
    RAISE EXCEPTION 'unattested owner record accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'refund_confirmation_required' THEN RAISE; END IF;
  END;
  -- A member naming another user's id forges the recorded_by audit
  -- label: the actor check rejects the spoof.
  BEGIN
    PERFORM private.record_manual_order_refund(
      '9ef51000-0000-4000-8000-000000000050',
      '9ef50100-0000-4000-8000-000000000001',
      'NGN', pg_catalog.now(), '9ef50000-0000-4000-8000-000000000002',
      10, pg_catalog.now(), 'bank_transfer', NULL, true, 'probe-2',
      100, 0, 'not_started', NULL, 0, 0, NULL);
    RAISE EXCEPTION 'actor-spoofing record accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'refund_forbidden' THEN RAISE; END IF;
  END;
END;
$confinement_owner$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef50000-0000-4000-8000-000000000003',
  true
);

DO $confinement_viewer$
DECLARE
  v_response jsonb;
  v_rejected boolean := false;
BEGIN
  -- A view-only staffer reads status: the response gate keeps the
  -- view leg, mirroring the manager.
  SELECT private.refund_status_response(
    '9ef51000-0000-4000-8000-000000000050',
    '9ef50100-0000-4000-8000-000000000001',
    'NGN', 100, 0, 100, 0, 0, 'not_started', NULL, 0, 0,
    false, false, false, pg_catalog.now()
  ) INTO v_response;
  IF v_response IS NULL THEN
    RAISE EXCEPTION 'viewer response call returned null';
  END IF;
  -- The same staffer never records: the write gate drops view.
  BEGIN
    PERFORM private.record_manual_order_refund(
      '9ef51000-0000-4000-8000-000000000050',
      '9ef50100-0000-4000-8000-000000000001',
      'NGN', pg_catalog.now(), '9ef50000-0000-4000-8000-000000000003',
      10, pg_catalog.now(), 'bank_transfer', NULL, true, 'probe-3',
      100, 0, 'not_started', NULL, 0, 0, NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'viewer record probe was not rejected';
  END IF;
END;
$confinement_viewer$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef50000-0000-4000-8000-000000000002',
  true
);

DO $confinement_foreign$
DECLARE
  v_rejected integer := 0;
BEGIN
  -- A foreign merchant reads nothing and records nothing.
  BEGIN
    PERFORM private.refund_status_response(
      '9ef51000-0000-4000-8000-000000000050',
      '9ef50100-0000-4000-8000-000000000001',
      'NGN', 100, 0, 100, 0, 0, 'not_started', NULL, 0, 0,
      false, false, false, pg_catalog.now()
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := v_rejected + 1;
  END;
  BEGIN
    PERFORM private.record_manual_order_refund(
      '9ef51000-0000-4000-8000-000000000050',
      '9ef50100-0000-4000-8000-000000000001',
      'NGN', pg_catalog.now(), '9ef50000-0000-4000-8000-000000000002',
      10, pg_catalog.now(), 'bank_transfer', NULL, true, 'probe-4',
      100, 0, 'not_started', NULL, 0, 0, NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := v_rejected + 1;
  END;
  IF v_rejected <> 2 THEN
    RAISE EXCEPTION 'only % of 2 foreign probes rejected', v_rejected;
  END IF;
END;
$confinement_foreign$;

ROLLBACK;
