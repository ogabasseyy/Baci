-- REGRESSION TEST: refund tenancy and read isolation.
--
-- Covers cross-merchant invisibility, viewer/denied
-- capabilities, and audit-event RLS.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_tenancy.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The
-- assertions below switch to authenticated explicitly per actor.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '9ef10000-0000-4000-8000-000000000001';
  v_manager_id uuid := '9ef10000-0000-4000-8000-000000000002';
  v_viewer_id uuid := '9ef10000-0000-4000-8000-000000000003';
  v_denied_id uuid := '9ef10000-0000-4000-8000-000000000004';
  v_m2_owner_id uuid := '9ef10000-0000-4000-8000-000000000005';
  v_merchant_id uuid := '9ef10100-0000-4000-8000-000000000001';
  v_m2_id uuid := '9ef10100-0000-4000-8000-000000000002';
  v_customer_id uuid := '9ef10200-0000-4000-8000-000000000001';
  v_product_id uuid := '9ef10300-0000-4000-8000-000000000001';
  v_goal_id uuid := '9ef10400-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_manager_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_viewer_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-viewer@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_denied_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-denied@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_m2_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-m2@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);


  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture'),
    (v_m2_id, v_m2_owner_id, 'refund-m2@example.test',
      'Refund Fixture Two', 'refund-fixture-two');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_manager_id, 'refund-manager@example.test',
      'Refund Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active'),
    (v_merchant_id, v_viewer_id, 'refund-viewer@example.test',
      'Refund Viewer', 'accountant',
      '{"orders":{"view":true}}'::jsonb, 'active'),
    (v_merchant_id, v_denied_id, 'refund-denied@example.test',
      'Refund Denied', 'accountant',
      '{"orders":{"view":false,"refund":false}}'::jsonb, 'active');


  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    (v_customer_id, v_merchant_id, 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'REFUND-001',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000009', v_m2_id, 'REFUND-009',
      10, 10, 'paid', 'cancelled'),
    -- Ineligible control: never cancelled, so no refund rows.
    ('9ef11000-0000-4000-8000-000000000010', v_merchant_id, 'REFUND-010',
      100, 100, 'paid', 'processing');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000009');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000001', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000001', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-1', '{}'::jsonb);

  INSERT INTO public.order_refund_events
    (order_id, merchant_id, action, created_at)
  VALUES ('9ef11000-0000-4000-8000-000000000001',
    '9ef10100-0000-4000-8000-000000000001', 'seed', pg_catalog.now());
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_visibility$
DECLARE
  v_result jsonb;
  v_rejected boolean;
  v_label text;
BEGIN
  -- Other merchants' orders are invisible to the manager.
  v_rejected := false;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000009');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := SQLERRM = 'refund_forbidden';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'cross-merchant refund read accepted';
  END IF;

END;
$refund_visibility$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000003',
  true
);

DO $refund_viewer$
DECLARE
  v_result jsonb;
  v_rejected boolean;
BEGIN
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF v_result->>'status' IS NULL THEN
    RAISE EXCEPTION 'view-authorized staff cannot read refund status';
  END IF;
  IF (v_result->>'canManageRefunds')::boolean THEN
    RAISE EXCEPTION 'staff without refund permission is flagged manageable';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'manual', 10,
      pg_catalog.now(), 'bank_transfer', 'staff-1',NULL,true);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := SQLERRM = 'refund_forbidden';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'view-authorized staff recorded a manual refund';
  END IF;
  -- Status stays readable for ineligible orders (the panel gates on
  -- visibility, not the RPC), but the ledger is empty by
  -- construction — no manual records without cancelled_at, no
  -- worker refunds without the cancelled claim — so no references,
  -- notes, legs, events, or actions leak to viewers.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000010'
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(COALESCE(v_result->'history', '[]')) <> 0
    OR pg_catalog.jsonb_array_length(COALESCE(v_result->'legs', '[]')) <> 0
    OR pg_catalog.jsonb_array_length(COALESCE(v_result->'events', '[]')) <> 0
    OR (v_result->>'canRecordManual')::boolean
    OR (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'ineligible status exposed ledger or actions';
  END IF;
END;
$refund_viewer$;


SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000004',
  true
);

DO $refund_denied$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := SQLERRM = 'refund_forbidden';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'denied staff read refund status';
  END IF;
END;
$refund_denied$;


SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000005',
  true
);

DO $refund_m2_isolation$
DECLARE
  v_event_count integer;
BEGIN
  SELECT count(*) INTO v_event_count FROM public.order_refund_events;
  IF v_event_count <> 0 THEN
    RAISE EXCEPTION 'refund audit RLS leaks across merchants';
  END IF;
END;
$refund_m2_isolation$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000003',
  true
);

DO $refund_event_actor_confinement$
DECLARE
  v_action text;
  v_rejected boolean;
BEGIN
  -- Missing and foreign orders are indistinguishable to callers.
  v_rejected := false;
  BEGIN
    PERFORM public.manage_order_refund('9ef1ffff-0000-4000-8000-000000000099');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := SQLERRM = 'refund_forbidden';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'missing order distinguishable from forbidden';
  END IF;
  -- A view-only staffer reads event actions through REST, but
  -- actor_id stays outside their column grant like the route mask.
  SELECT action INTO v_action FROM public.order_refund_events
   WHERE order_id = '9ef11000-0000-4000-8000-000000000001';
  IF v_action IS NULL THEN
    RAISE EXCEPTION 'viewer lost event action reads';
  END IF;
  BEGIN
    PERFORM actor_id FROM public.order_refund_events
     WHERE order_id = '9ef11000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'viewer read event actor_id directly';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
END;
$refund_event_actor_confinement$;

ROLLBACK;
