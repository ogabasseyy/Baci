-- REGRESSION TEST: masking, privilege, and label boundaries.
--
-- Covers audit-label masking, order-less ledger commits, the
-- authenticated/private privilege boundary, and error labels.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_boundaries.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The
-- assertions below switch to authenticated explicitly per actor.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_label text;
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    ('9ef10000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-viewer@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-denied@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-m2@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);


  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000001', 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture'),
    ('9ef10100-0000-4000-8000-000000000002', '9ef10000-0000-4000-8000-000000000005', 'refund-m2@example.test',
      'Refund Fixture Two', 'refund-fixture-two');

END;
$fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);


-- The readable audit table stores fixed labels, never raw worker or
-- provider text: direct REST readers bypass route masking, so the
-- trigger maps at write time while raw text stays in side_effects.

DO $refund_audit_masking$
DECLARE
  v_details jsonb;
  v_raw text;
BEGIN
  -- Isolated order: no other block touches it, so its single event is
  -- deterministic (created_at ties make latest-row queries ambiguous).
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES (
    '9ef11000-0000-4000-8000-000000000099',
    '9ef10100-0000-4000-8000-000000000001', 'REFUND-099',
    100, 100, 'paid', 'cancelled');
  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES (
    '9ef11000-0000-4000-8000-000000000099',
    '9ef10100-0000-4000-8000-000000000001', 'refund',
    'failed', '9ef13000-0000-4000-8000-000000000099', 1,
    'Paystack/insufficient-balance (acquirer 51)');
  SELECT details INTO v_details FROM public.order_refund_events
   WHERE order_id = '9ef11000-0000-4000-8000-000000000099';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit trigger did not fire for side_effects insert';
  END IF;
  IF v_details->>'error' <> 'The refund ran into a problem. Support has the details.'
    OR v_details::text LIKE '%Paystack%' THEN
    RAISE EXCEPTION 'audit event leaked raw worker text: %', v_details;
  END IF;
  SELECT error INTO v_raw FROM public.order_cancellation_side_effects
   WHERE order_id = '9ef11000-0000-4000-8000-000000000099'
     AND step = 'refund';
  IF v_raw IS DISTINCT FROM 'Paystack/insufficient-balance (acquirer 51)' THEN
    RAISE EXCEPTION 'side_effects raw error not retained';
  END IF;
END;
$refund_audit_masking$;

DO $refund_boundaries$
DECLARE
  v_count integer;
BEGIN
  -- Order-less ledger refunds (e.g. savings exits) still commit: the
  -- sync trigger skips them instead of violating the audit NOT NULL.
  INSERT INTO public.transactions (
    merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference
  ) VALUES ('9ef10100-0000-4000-8000-000000000001', NULL, 'refund', 10,
    'NGN', 'completed', 'piggyvest', 'null-order-probe');
  IF EXISTS (SELECT 1 FROM public.order_refund_events
    WHERE details->>'reference' = 'null-order-probe') THEN
    RAISE EXCEPTION 'order-less refund wrote an audit event';
  END IF;

  -- Anonymous callers and direct private access stay denied.
  IF pg_catalog.has_function_privilege('anon',
    'public.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean,uuid)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'anonymous callers can execute the refund RPC';
  END IF;
  IF pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'private schema boundary open to authenticated';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated',
    'private.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean,uuid)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'direct private refund RPC allowed';
  END IF;

  -- Worker-error labels match review keywords case-insensitively.
  IF private.describe_refund_worker_error_v1('Review required: mismatch')
    <> 'This refund needs review before it can continue.' THEN
    RAISE EXCEPTION 'capitalized review keyword missed';
  END IF;
  IF private.describe_refund_worker_error_v1('RECONCILIATION pending')
    <> 'This refund needs review before it can continue.' THEN
    RAISE EXCEPTION 'uppercase reconciliation keyword missed';
  END IF;
  IF private.describe_refund_worker_error_v1(
    'cancellation_refund_preflight_deferred_for_budget')
    <> 'Refund in progress — queued to resume automatically.' THEN
    RAISE EXCEPTION 'budget deferral mislabeled as failure';
  END IF;
END;
$refund_boundaries$;
ROLLBACK;
