-- =====================================================================
-- REGRESSION TEST: mobile-admin order-count aggregate RPC
--
-- USAGE:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--     -f supabase/tests/mobile_admin_order_counts_rpc.sql
-- =====================================================================

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '8a0d0e12-0000-4000-8000-000000000001';
  v_staff_id uuid := '8a0d0e12-0000-4000-8000-000000000002';
  v_suspended_staff_id uuid := '8a0d0e12-0000-4000-8000-000000000003';
  v_other_owner_id uuid := '8a0d0e12-0000-4000-8000-000000000004';
  v_platform_admin_id uuid := '8a0d0e12-0000-4000-8000-000000000005';
  v_merchant_id uuid := '8a0d0e12-0000-4000-8000-000000000101';
  v_other_merchant_id uuid := '8a0d0e12-0000-4000-8000-000000000102';
  v_platform_merchant_id uuid := '8a0d0e12-0000-4000-8000-000000000103';
  v_branch_a_id uuid := '8a0d0e12-0000-4000-8000-000000000201';
  v_branch_b_id uuid := '8a0d0e12-0000-4000-8000-000000000202';
  v_other_branch_id uuid := '8a0d0e12-0000-4000-8000-000000000203';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'order-count-owner@example.com',
      'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb),
    (v_staff_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'order-count-staff@example.com',
      'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb),
    (v_suspended_staff_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'order-count-suspended@example.com',
      'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb),
    (v_other_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'order-count-other@example.com',
      'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb),
    (v_platform_admin_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'order-count-admin@example.com',
      'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (
    id, user_id, email, business_name, slug, is_platform_admin
  ) VALUES
    (v_merchant_id, v_owner_id, 'order-count-owner@example.com',
      'Order Count Fixture', 'order-count-fixture', false),
    (v_other_merchant_id, v_other_owner_id, 'order-count-other@example.com',
      'Other Order Count Fixture', 'other-order-count-fixture', false),
    (v_platform_merchant_id, v_platform_admin_id,
      'order-count-admin@example.com', 'Platform Admin Order Count Fixture',
      'platform-admin-order-count-fixture', true);

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_staff_id, 'order-count-staff@example.com',
      'Active Count Staff', 'accountant',
      '{"orders":{"view":false}}'::jsonb, 'active'),
    (v_merchant_id, v_suspended_staff_id,
      'order-count-suspended@example.com', 'Suspended Count Staff',
      'accountant', '{"orders":{"view":true}}'::jsonb, 'suspended');

  PERFORM pg_catalog.set_config(
    'app.branch_audit_actor_id', v_owner_id::text, true
  );

  INSERT INTO public.branches (
    id, merchant_id, name, is_default, active
  ) VALUES
    (v_branch_a_id, v_merchant_id, 'Count Branch A', true, true),
    (v_branch_b_id, v_merchant_id, 'Count Branch B', false, true),
    (v_other_branch_id, v_other_merchant_id, 'Other Count Branch', true, true);

  INSERT INTO public.orders (
    id, merchant_id, branch_id, order_number, shipping_status,
    payment_status, payment_method, total
  ) VALUES
    ('8a0d0e12-0000-4000-8000-000000000301', v_merchant_id,
      v_branch_a_id, 'COUNT-001', 'pending', 'paid', 'paystack', 100),
    ('8a0d0e12-0000-4000-8000-000000000302', v_merchant_id,
      v_branch_a_id, 'COUNT-002', 'processing', 'paid', 'korapay', 100),
    ('8a0d0e12-0000-4000-8000-000000000303', v_merchant_id,
      v_branch_a_id, 'COUNT-003', 'shipped', 'unpaid', 'cash', 100),
    ('8a0d0e12-0000-4000-8000-000000000304', v_merchant_id,
      v_branch_b_id, 'COUNT-004', 'delivered', 'pending', NULL, 100),
    ('8a0d0e12-0000-4000-8000-000000000305', v_merchant_id,
      v_branch_b_id, 'COUNT-005', 'cancelled', 'paid', 'juicyway', 100),
    ('8a0d0e12-0000-4000-8000-000000000306', v_merchant_id,
      NULL, 'COUNT-006', 'returned', 'paid', 'bank_transfer', 100),
    ('8a0d0e12-0000-4000-8000-000000000307', v_merchant_id,
      v_branch_a_id, 'COUNT-HIDDEN-001', 'pending', 'bnpl_pending',
      'credit_direct', 100),
    ('8a0d0e12-0000-4000-8000-000000000308', v_merchant_id,
      v_branch_a_id, 'COUNT-HIDDEN-002', 'processing', 'failed',
      'paystack', 100),
    ('8a0d0e12-0000-4000-8000-000000000309', v_merchant_id,
      v_branch_a_id, 'COUNT-HIDDEN-003', 'shipped', 'expired',
      'paystack', 100),
    ('8a0d0e12-0000-4000-8000-000000000310', v_merchant_id,
      v_branch_a_id, 'COUNT-HIDDEN-004', 'delivered', 'pending',
      'paystack', 100),
    ('8a0d0e12-0000-4000-8000-000000000311', v_merchant_id,
      v_branch_a_id, 'COUNT-HIDDEN-005', 'cancelled', 'unpaid',
      'korapay', 100),
    ('8a0d0e12-0000-4000-8000-000000000312', v_other_merchant_id,
      v_other_branch_id, 'COUNT-OTHER-001', 'pending', 'paid',
      'paystack', 100);
END;
$fixtures$;

CREATE OR REPLACE FUNCTION pg_temp.assert_mobile_admin_order_counts(
  p_claim_role text,
  p_user_id uuid,
  p_merchant_id uuid,
  p_branch_id uuid,
  p_expected jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_actual jsonb;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.role', p_claim_role, true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', COALESCE(p_user_id::text, ''), true
  );

  SELECT public.get_mobile_admin_order_counts(p_merchant_id, p_branch_id)
  INTO v_actual;

  IF v_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'expected order counts %, got %', p_expected, v_actual;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_mobile_admin_order_counts(text, uuid, uuid, uuid, jsonb) TO PUBLIC; -- called after SET ROLE

SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_mobile_admin_order_counts(
  'authenticated',
  '8a0d0e12-0000-4000-8000-000000000001',
  '8a0d0e12-0000-4000-8000-000000000101',
  NULL,
  '{"all":6,"paid":4,"pending":1,"processing":1,"shipped":1,"delivered":1,"cancelled":1,"returned":1}'::jsonb
);
SELECT pg_temp.assert_mobile_admin_order_counts(
  'authenticated',
  '8a0d0e12-0000-4000-8000-000000000002',
  '8a0d0e12-0000-4000-8000-000000000101',
  '8a0d0e12-0000-4000-8000-000000000201',
  '{"all":3,"paid":2,"pending":1,"processing":1,"shipped":1,"delivered":0,"cancelled":0,"returned":0}'::jsonb
);
SELECT pg_temp.assert_mobile_admin_order_counts(
  'authenticated',
  '8a0d0e12-0000-4000-8000-000000000005',
  '8a0d0e12-0000-4000-8000-000000000103',
  NULL,
  '{"all":0,"paid":0,"pending":0,"processing":0,"shipped":0,"delivered":0,"cancelled":0,"returned":0}'::jsonb
);

DO $canonical_parity$
DECLARE
  v_rpc jsonb;
  v_direct jsonb;
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role', 'authenticated', true
  );
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '8a0d0e12-0000-4000-8000-000000000001',
    true
  );

  SELECT public.get_mobile_admin_order_counts(
    '8a0d0e12-0000-4000-8000-000000000101',
    NULL
  ) INTO v_rpc;

  SELECT pg_catalog.jsonb_build_object(
    'all', COUNT(*),
    'paid', COUNT(*) FILTER (WHERE orders.payment_status = 'paid'),
    'pending', COUNT(*) FILTER (WHERE orders.shipping_status = 'pending'),
    'processing', COUNT(*) FILTER (WHERE orders.shipping_status = 'processing'),
    'shipped', COUNT(*) FILTER (WHERE orders.shipping_status = 'shipped'),
    'delivered', COUNT(*) FILTER (WHERE orders.shipping_status = 'delivered'),
    'cancelled', COUNT(*) FILTER (WHERE orders.shipping_status = 'cancelled'),
    'returned', COUNT(*) FILTER (WHERE orders.shipping_status = 'returned')
  )
  INTO v_direct
  FROM public.orders AS orders
  WHERE orders.merchant_id = '8a0d0e12-0000-4000-8000-000000000101'
    AND orders.payment_status NOT IN ('bnpl_pending', 'failed', 'expired')
    AND (
      orders.payment_status NOT IN ('pending', 'unpaid')
      OR orders.payment_method IS NULL
      OR orders.payment_method NOT IN (
        'paystack', 'korapay', 'bank_transfer', 'credit_direct',
        'credpal', 'klump', 'juicyway'
      )
    );

  IF v_rpc IS DISTINCT FROM v_direct THEN
    RAISE EXCEPTION 'RPC % differs from direct-query predicate %', v_rpc, v_direct;
  END IF;
END;
$canonical_parity$;

DO $authenticated_guards$
DECLARE
  v_rejected boolean;
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role', 'authenticated', true
  );

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '8a0d0e12-0000-4000-8000-000000000003',
    true
  );
  v_rejected := false;
  BEGIN
    PERFORM public.get_mobile_admin_order_counts(
      '8a0d0e12-0000-4000-8000-000000000101', NULL
    );
  EXCEPTION
    WHEN SQLSTATE '42501' THEN
      v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'suspended staff unexpectedly read order counts';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '8a0d0e12-0000-4000-8000-000000000005',
    true
  );
  v_rejected := false;
  BEGIN
    PERFORM public.get_mobile_admin_order_counts(
      '8a0d0e12-0000-4000-8000-000000000101', NULL
    );
  EXCEPTION
    WHEN SQLSTATE '42501' THEN
      v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION
      'platform admin without merchant access unexpectedly read another tenant';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '8a0d0e12-0000-4000-8000-000000000001',
    true
  );
  v_rejected := false;
  BEGIN
    PERFORM public.get_mobile_admin_order_counts(NULL, NULL);
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'null merchant id unexpectedly accepted';
  END IF;
END;
$authenticated_guards$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.assert_mobile_admin_order_counts(
  'service_role',
  NULL,
  '8a0d0e12-0000-4000-8000-000000000102',
  NULL,
  '{"all":1,"paid":1,"pending":1,"processing":0,"shipped":0,"delivered":0,"cancelled":0,"returned":0}'::jsonb
);

ROLLBACK;
