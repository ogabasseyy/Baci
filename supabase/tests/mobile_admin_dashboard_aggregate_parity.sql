-- Role and semantic parity for the consolidated mobile-admin dashboard RPCs.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner uuid := '9b0d0e12-0000-4000-8000-000000000001';
  v_staff uuid := '9b0d0e12-0000-4000-8000-000000000002';
  v_suspended uuid := '9b0d0e12-0000-4000-8000-000000000003';
  v_other_owner uuid := '9b0d0e12-0000-4000-8000-000000000004';
  v_merchant uuid := '9b0d0e12-0000-4000-8000-000000000101';
  v_other_merchant uuid := '9b0d0e12-0000-4000-8000-000000000102';
  v_branch_a uuid := '9b0d0e12-0000-4000-8000-000000000201';
  v_branch_b uuid := '9b0d0e12-0000-4000-8000-000000000202';
  v_other_branch uuid := '9b0d0e12-0000-4000-8000-000000000203';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'dashboard-owner@example.com',
      'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_staff, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'dashboard-staff@example.com',
      'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_suspended, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'dashboard-suspended@example.com',
      'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_other_owner, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'dashboard-other@example.com',
      'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant, v_owner, 'dashboard-owner@example.com',
      'Dashboard Fixture', 'dashboard-fixture'),
    (v_other_merchant, v_other_owner, 'dashboard-other@example.com',
      'Other Dashboard Fixture', 'other-dashboard-fixture');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant, v_staff, 'dashboard-staff@example.com', 'Active Staff',
      'accountant', '{"orders":{"view":false}}'::jsonb, 'active'),
    (v_merchant, v_suspended, 'dashboard-suspended@example.com',
      'Suspended Staff', 'accountant',
      '{"orders":{"view":true}}'::jsonb, 'suspended');

  PERFORM pg_catalog.set_config(
    'app.branch_audit_actor_id', v_owner::text, true
  );
  INSERT INTO public.branches (id, merchant_id, name, is_default, active)
  VALUES
    (v_branch_a, v_merchant, 'Dashboard A', true, true),
    (v_branch_b, v_merchant, 'Dashboard B', false, true),
    (v_other_branch, v_other_merchant, 'Other Dashboard', true, true);

  INSERT INTO public.orders (
    id, merchant_id, branch_id, order_number, created_at,
    shipping_status, payment_status, total, currency
  ) VALUES
    ('9b0d0e12-0000-4000-8000-000000000301', v_merchant, v_branch_a,
      'DASH-001', '2026-07-02 01:00+00', 'pending', 'paid', 100, 'NGN'),
    ('9b0d0e12-0000-4000-8000-000000000302', v_merchant, v_branch_a,
      'DASH-002', '2026-07-02 02:00+00', 'delivered', 'paid', 200, 'USD'),
    ('9b0d0e12-0000-4000-8000-000000000303', v_merchant, v_branch_a,
      'DASH-POD-PENDING', '2026-07-02 03:00+00',
      'pending', 'pending', 900, 'NGN'),
    ('9b0d0e12-0000-4000-8000-000000000304', v_merchant, v_branch_a,
      'DASH-PREVIOUS', '2026-06-15 01:00+00', 'cancelled', 'paid', 50, 'NGN'),
    ('9b0d0e12-0000-4000-8000-000000000305', v_merchant, v_branch_a,
      'DASH-OLD-PENDING', '2026-05-15 01:00+00', 'pending', 'paid', 25, 'NGN'),
    ('9b0d0e12-0000-4000-8000-000000000306', v_merchant, v_branch_a,
      'DASH-REFUNDED', '2026-07-02 04:00+00', 'pending', 'refunded', 700, 'NGN'),
    ('9b0d0e12-0000-4000-8000-000000000307', v_merchant, v_branch_b,
      'DASH-BRANCH-B', '2026-07-04 01:00+00', 'shipped', 'paid', 300, 'NGN'),
    ('9b0d0e12-0000-4000-8000-000000000308', v_merchant, NULL,
      'DASH-NULL-BRANCH', '2026-07-05 01:00+00', 'pending', 'paid', 400, 'NGN'),
    ('9b0d0e12-0000-4000-8000-000000000310', v_merchant, v_branch_a,
      'DASH-CURRENT-BOUNDARY', '2026-07-01 00:00+00',
      'pending', 'paid', 10, 'NGN'),
    ('9b0d0e12-0000-4000-8000-000000000311', v_merchant, v_branch_a,
      'DASH-PREVIOUS-START', '2026-06-01 00:00+00',
      'delivered', 'paid', 20, 'NGN'),
    ('9b0d0e12-0000-4000-8000-000000000312', v_merchant, v_branch_a,
      'DASH-ADJACENT-BOUNDARY', '2026-07-03 00:00+00',
      'shipped', 'paid', 30, 'NGN'),
    ('9b0d0e12-0000-4000-8000-000000000313', v_merchant, v_branch_a,
      'DASH-CHART-END', '2026-07-10 00:00+00',
      'delivered', 'paid', 40, 'NGN'),
    ('9b0d0e12-0000-4000-8000-000000000314', v_merchant, v_branch_a,
      'DASH-NULL-CREATED', NULL, 'pending', 'paid', 0, 'NGN'),
    ('9b0d0e12-0000-4000-8000-000000000309', v_other_merchant,
      v_other_branch, 'DASH-OTHER', '2026-07-02 01:00+00',
      'pending', 'paid', 999, 'NGN');

  INSERT INTO public.order_items (order_id, name, price, quantity) VALUES
    ('9b0d0e12-0000-4000-8000-000000000301', 'Paid A', 50, 2),
    ('9b0d0e12-0000-4000-8000-000000000302', 'Paid B', 50, 3),
    ('9b0d0e12-0000-4000-8000-000000000303', 'Unpaid', 10, 90),
    ('9b0d0e12-0000-4000-8000-000000000304', 'Previous', 50, 1),
    ('9b0d0e12-0000-4000-8000-000000000305', 'Old', 25, 6),
    ('9b0d0e12-0000-4000-8000-000000000306', 'Refunded', 10, 70),
    ('9b0d0e12-0000-4000-8000-000000000307', 'Branch B', 75, 4),
    ('9b0d0e12-0000-4000-8000-000000000308', 'No Branch', 80, 5),
    ('9b0d0e12-0000-4000-8000-000000000310', 'Current Boundary', 10, 1),
    ('9b0d0e12-0000-4000-8000-000000000311', 'Previous Start', 10, 2),
    ('9b0d0e12-0000-4000-8000-000000000312', 'Adjacent Boundary', 10, 3),
    ('9b0d0e12-0000-4000-8000-000000000313', 'Chart End', 10, 4);

  INSERT INTO public.customers (merchant_id, email, created_at) VALUES
    (v_merchant, 'dashboard-new@example.com', '2026-07-03 00:00+00'),
    (v_merchant, 'dashboard-old@example.com', '2026-05-03 00:00+00'),
    (v_other_merchant, 'dashboard-other-customer@example.com',
      '2026-07-03 00:00+00');

  INSERT INTO public.analytics_events (
    merchant_id, event_type, event_data, created_at
  ) VALUES
    (v_merchant, 'page_view', '{}'::jsonb, '2026-07-03 01:00+00'),
    (v_merchant, 'page_view', '{}'::jsonb, '2026-07-04 01:00+00'),
    (v_merchant, 'page_view', '{}'::jsonb, '2026-05-04 01:00+00'),
    (v_merchant, 'purchase', '{}'::jsonb, '2026-07-03 01:00+00'),
    (v_other_merchant, 'page_view', '{}'::jsonb, '2026-07-03 01:00+00');
END;
$fixtures$;

CREATE OR REPLACE FUNCTION pg_temp.assert_jsonb(
  p_label text, p_actual jsonb, p_expected jsonb
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION '% expected %, got %', p_label, p_expected, p_actual;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_jsonb(text, jsonb, jsonb) TO PUBLIC; -- called after SET ROLE

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '9b0d0e12-0000-4000-8000-000000000001', true
);

-- pendingOrders preserves the original all-time, branch-scoped shipping
-- backlog regardless of payment status; period bounds intentionally do not apply.
SELECT pg_temp.assert_jsonb(
  'all-branch dashboard stats',
  public.get_mobile_admin_dashboard_stats(
    '9b0d0e12-0000-4000-8000-000000000101',
    '2026-07-01 00:00+00', '2026-06-01 00:00+00',
    '2026-07-01 00:00+00', NULL
  ),
  '{"avgOrderValue":154,"newCustomers":1,"orders":7,"pendingOrders":7,"previousPeriodRevenue":70,"revenue":1080,"totalCustomers":2,"totalItems":22,"visits":2}'::jsonb
);

SELECT pg_temp.assert_jsonb(
  'branch dashboard stats',
  public.get_mobile_admin_dashboard_stats(
    '9b0d0e12-0000-4000-8000-000000000101',
    '2026-07-01 00:00+00', '2026-06-01 00:00+00',
    '2026-07-01 00:00+00',
    '9b0d0e12-0000-4000-8000-000000000201'
  ),
  '{"avgOrderValue":76,"newCustomers":1,"orders":5,"pendingOrders":6,"previousPeriodRevenue":70,"revenue":380,"totalCustomers":2,"totalItems":13,"visits":2}'::jsonb
);

SELECT pg_temp.assert_jsonb(
  'all-branch revenue chart',
  public.get_mobile_admin_revenue_chart(
    '9b0d0e12-0000-4000-8000-000000000101',
    '[{"ordinal":2,"label":"All","start_at":"2026-07-01T00:00:00Z","end_at":"2026-07-10T00:00:00Z"},{"ordinal":3,"label":"Previous","start_at":"2026-06-01T00:00:00Z","end_at":"2026-07-01T00:00:00Z"},{"ordinal":0,"label":"Early","start_at":"2026-07-01T00:00:00Z","end_at":"2026-07-03T00:00:00Z"},{"ordinal":1,"label":"Late","start_at":"2026-07-03T00:00:00Z","end_at":"2026-07-10T00:00:00Z"}]'::jsonb,
    NULL
  ),
  '[{"label":"Early","value":310},{"label":"Late","value":730},{"label":"All","value":1040},{"label":"Previous","value":70}]'::jsonb
);

SELECT pg_temp.assert_jsonb(
  'branch revenue chart',
  public.get_mobile_admin_revenue_chart(
    '9b0d0e12-0000-4000-8000-000000000101',
    '[{"ordinal":0,"label":"Early","start_at":"2026-07-01T00:00:00Z","end_at":"2026-07-03T00:00:00Z"},{"ordinal":1,"label":"Late","start_at":"2026-07-03T00:00:00Z","end_at":"2026-07-10T00:00:00Z"},{"ordinal":2,"label":"Previous","start_at":"2026-06-01T00:00:00Z","end_at":"2026-07-01T00:00:00Z"}]'::jsonb,
    '9b0d0e12-0000-4000-8000-000000000201'
  ),
  '[{"label":"Early","value":310},{"label":"Late","value":30},{"label":"Previous","value":70}]'::jsonb
);

SELECT pg_temp.assert_jsonb(
  'empty revenue chart',
  public.get_mobile_admin_revenue_chart(
    '9b0d0e12-0000-4000-8000-000000000101', '[]'::jsonb, NULL
  ),
  '[]'::jsonb
);

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '9b0d0e12-0000-4000-8000-000000000002', true
);
-- The all-time call preserves the same payment-independent pending backlog.
SELECT pg_temp.assert_jsonb(
  'active-staff all-time dashboard stats',
  public.get_mobile_admin_dashboard_stats(
    '9b0d0e12-0000-4000-8000-000000000101',
    NULL, NULL, NULL, NULL
  ),
  '{"avgOrderValue":107,"newCustomers":2,"orders":11,"pendingOrders":7,"previousPeriodRevenue":0,"revenue":1175,"totalCustomers":2,"totalItems":31,"visits":3}'::jsonb
);

DO $guards$
DECLARE
  v_rejected boolean;
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', '9b0d0e12-0000-4000-8000-000000000003', true
  );
  v_rejected := false;
  BEGIN
    PERFORM public.get_mobile_admin_dashboard_stats(
      '9b0d0e12-0000-4000-8000-000000000101', NULL, NULL, NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'suspended staff unexpectedly read dashboard stats';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', '9b0d0e12-0000-4000-8000-000000000004', true
  );
  v_rejected := false;
  BEGIN
    PERFORM public.get_mobile_admin_revenue_chart(
      '9b0d0e12-0000-4000-8000-000000000101', '[]'::jsonb, NULL
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'cross-tenant owner unexpectedly read revenue chart';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.get_mobile_admin_dashboard_stats(
      NULL, NULL, NULL, NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'null merchant unexpectedly accepted';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.get_mobile_admin_revenue_chart(
      '9b0d0e12-0000-4000-8000-000000000102', NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'null buckets unexpectedly accepted';
  END IF;
END;
$guards$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_temp.assert_jsonb(
  'service-role revenue chart',
  public.get_mobile_admin_revenue_chart(
    '9b0d0e12-0000-4000-8000-000000000102',
    '[{"ordinal":0,"label":"Other","start_at":"2026-07-01T00:00:00Z","end_at":"2026-07-10T00:00:00Z"}]'::jsonb,
    NULL
  ),
  '[{"label":"Other","value":999}]'::jsonb
);

ROLLBACK;
