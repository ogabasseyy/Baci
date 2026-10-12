-- REGRESSION TEST: merchant cancellation-refund management RPC.
--
-- Covers public.manage_order_refund (status/retry/manual), the refund
-- audit/sync triggers, and the authenticated refund-insert boundary.
-- Runs against the migrated replay database: fixtures use real tables
-- and roll back with the check.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management.sql

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

  INSERT INTO public.products (id, merchant_id, name, price, status) VALUES
    (v_product_id, v_merchant_id, 'Refund Fixture Product', 100, 'active');

  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, target_amount,
    contribution_amount, contribution_frequency, start_date, maturity_date,
    source_mode, terms_accepted_at, non_withdrawable_accepted_at
  ) VALUES (
    v_goal_id, v_merchant_id, v_customer_id, v_product_id,
    'Refund Fixture Goal', 100, 10, 'weekly', '2026-01-01', '2026-12-31',
    'manual', pg_catalog.now(), pg_catalog.now()
  );

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'REFUND-001',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000002', v_merchant_id, 'REFUND-002',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000003', v_merchant_id, 'REFUND-003',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000004', v_merchant_id, 'REFUND-004',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000005', v_merchant_id, 'REFUND-005',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000006', v_merchant_id, 'REFUND-006',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000007', v_merchant_id, 'REFUND-007',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000008', v_merchant_id, 'REFUND-008',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000009', v_m2_id, 'REFUND-009',
      10, 10, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000010', v_merchant_id, 'REFUND-010',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000011', v_merchant_id, 'REFUND-011',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000012', v_merchant_id, 'REFUND-012',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000013', v_merchant_id, 'REFUND-013',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000014', v_merchant_id, 'REFUND-014',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000015', v_merchant_id, 'REFUND-015',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000016', v_merchant_id, 'REFUND-016',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000017', v_merchant_id, 'REFUND-017',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000018', v_merchant_id, 'REFUND-018',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000019', v_merchant_id, 'REFUND-019',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000020', v_merchant_id, 'REFUND-020',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000021', v_merchant_id, 'REFUND-021',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000022', v_merchant_id, 'REFUND-022',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000023', v_merchant_id, 'REFUND-023',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000024', v_merchant_id, 'REFUND-024',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000025', v_merchant_id, 'REFUND-025',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000026', v_merchant_id, 'REFUND-026',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000027', v_merchant_id, 'REFUND-027',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000034', v_merchant_id, 'REFUND-034',
      200, 200, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000052', v_merchant_id, 'REFUND-052',
      100, 100, 'paid', 'cancelled');
    -- Per-leg coverage fixtures (028+) live in
    -- order_refund_management_per_leg_coverage.sql per the 300-line
    -- boundary.

  -- Cancelled orders carry their cancellation timestamp; REFUND-012 is
  -- the legacy exception proving the manual gate requires it.
  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id <> '9ef11000-0000-4000-8000-000000000012'
    AND id IN (
      '9ef11000-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000002',
      '9ef11000-0000-4000-8000-000000000003',
      '9ef11000-0000-4000-8000-000000000004',
      '9ef11000-0000-4000-8000-000000000005',
      '9ef11000-0000-4000-8000-000000000006',
      '9ef11000-0000-4000-8000-000000000007',
      '9ef11000-0000-4000-8000-000000000008',
      '9ef11000-0000-4000-8000-000000000009',
      '9ef11000-0000-4000-8000-000000000010',
      '9ef11000-0000-4000-8000-000000000011',
      '9ef11000-0000-4000-8000-000000000013',
      '9ef11000-0000-4000-8000-000000000014',
      '9ef11000-0000-4000-8000-000000000015',
      '9ef11000-0000-4000-8000-000000000016',
      '9ef11000-0000-4000-8000-000000000017',
      '9ef11000-0000-4000-8000-000000000018',
      '9ef11000-0000-4000-8000-000000000019',
      '9ef11000-0000-4000-8000-000000000020',
      '9ef11000-0000-4000-8000-000000000021',
      '9ef11000-0000-4000-8000-000000000022',
      '9ef11000-0000-4000-8000-000000000023',
      '9ef11000-0000-4000-8000-000000000024',
      '9ef11000-0000-4000-8000-000000000025',
      '9ef11000-0000-4000-8000-000000000026',
      '9ef11000-0000-4000-8000-000000000027',
      '9ef11000-0000-4000-8000-000000000034',
      '9ef11000-0000-4000-8000-000000000052');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000001', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000001', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-1', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000002', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000002', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-2a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000003', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000002', 'payment', 40, 'NGN',
      'completed', 'paystack', 'cap-2b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000004', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000003', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-3', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000005', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000003', 'refund', 30, 'NGN',
      'refunded', 'paystack', 'legacy-3',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000004',
        'provider_refund_status', 'processed')),
    -- Split tender with the wallet/savings reversals below: the
    -- external leg must equal the reversal-adjusted remainder, or the
    -- overfunded-ledger guard (and the claim's full-leg coverage)
    -- could never let a capped manual finish the order.
    ('9ef12000-0000-4000-8000-000000000006', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000004', 'payment', 50, 'NGN',
      'completed', 'paystack', 'cap-4', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000007', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000005', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-5', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000008', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000005', 'refund', 10, 'NGN',
      'completed', 'paystack', '777005',
      jsonb_build_object('provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000009', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000006', 'payment', 40, 'NGN',
      'completed', 'wallet', 'w-6', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000010', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000006', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-6', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000011', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000007', 'payment', 100, 'NGN',
      'completed', 'wallet', 'w-7', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000012', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000008', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-8', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000013', v_m2_id,
      '9ef11000-0000-4000-8000-000000000009', 'payment', 10, 'NGN',
      'completed', 'paystack', 'cap-9', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000014', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000010', 'payment', 100, 'ngn',
      'completed', 'paystack', 'cap-10', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000015', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000011', 'payment', 100, 'USD',
      'completed', 'paystack', 'cap-11', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000016', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000012', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-12', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000017', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000013', 'payment', 100, 'NGN',
      'refunded', 'paypal', 'pp-13', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000018', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000014', 'payment', 100, 'NGN',
      'refund_pending', 'paypal', 'pp-14', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000019', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000015', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-15', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000020', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000015', 'refund', 30, 'USD',
      'completed', 'paystack', 'fx-15',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000019')),
    ('9ef12000-0000-4000-8000-000000000021', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000016', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-16', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000022', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000016', 'refund', 100, 'NGN',
      'refunded', 'paystack', 'legacy-16',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000021',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000023', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000017', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-17', '{}'::jsonb),
    -- A completed row claiming another order's leg: corrupt evidence
    -- the worker quarantines, never coverage.
    ('9ef12000-0000-4000-8000-000000000025', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000017', 'refund', 100, 'NGN',
      'completed', 'paystack', 'badlink-1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000004')),
    -- An unverified legacy Paystack refund: in-flight money, not
    -- returned money, until the provider confirms it.
    ('9ef12000-0000-4000-8000-000000000026', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000018', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-18', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000027', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000018', 'refund', 100, 'NGN',
      'completed', 'paystack', 'legacy-18',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000026')),
    -- A cash-only cancellation: no external leg at all.
    ('9ef12000-0000-4000-8000-000000000028', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000019', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-19', '{}'::jsonb),
    -- A mixed cancellation: verified provider money plus an
    -- outstanding cash balance the merchant still owes.
    ('9ef12000-0000-4000-8000-000000000029', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000020', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-20', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000030', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000020', 'refund', 60, 'NGN',
      'completed', 'paystack', 'pp-20',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000029',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000031', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000020', 'payment', 40, 'NGN',
      'completed', 'cash', 'cash-20', '{}'::jsonb),
    -- An overfunded ledger: the payment leg exceeds the recorded
    -- amount paid, so no manual remainder can cover it.
    ('9ef12000-0000-4000-8000-000000000032', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000021', 'payment', 120, 'NGN',
      'completed', 'paystack', 'cap-21', '{}'::jsonb),
    -- Several legs plus one unlinked refund: unattributable until
    -- operations links it, never whole-order coverage.
    ('9ef12000-0000-4000-8000-000000000033', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000022', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-22a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000034', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000022', 'payment', 40, 'NGN',
      'completed', 'paystack', 'cap-22b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000035', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000022', 'refund', 100, 'NGN',
      'completed', 'paystack', 'unlinked-22',
      jsonb_build_object('provider_refund_status', 'processed')),
    -- A sole leg with an unlinked refund from another gateway: the
    -- claim requires a gateway match, so this waits in pending.
    ('9ef12000-0000-4000-8000-000000000036', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000023', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-23', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000037', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000023', 'refund', 100, 'NGN',
      'completed', 'korapay', 'unlinked-23', '{}'::jsonb),
    -- An unlinked manual row never sole-attributes, like the claim.
    ('9ef12000-0000-4000-8000-000000000038', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000024', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-24', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000039', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000024', 'refund', 100, 'NGN',
      'completed', 'manual', 'man-24', '{}'::jsonb),
    -- Partial coverage on an overfunded leg: the outstanding 90 fits
    -- the recorded 100 but not the live remainder of 80, so no
    -- manual can finish it.
    ('9ef12000-0000-4000-8000-000000000040', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000025', 'payment', 110, 'NGN',
      'completed', 'paystack', 'cap-25', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000041', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000025', 'refund', 20, 'NGN',
      'completed', 'paystack', 'pp-25',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000040',
        'provider_refund_status', 'processed')),
    -- A cross-gateway row linked to the leg: the claim rejects the
    -- mismatch, so status must hold it in pending, not count it.
    ('9ef12000-0000-4000-8000-000000000042', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000026', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-26', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000043', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000026', 'refund', 100, 'NGN',
      'completed', 'korapay', 'kora-26',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000042')),
    -- A direct-Paystack manual record lands here via the RPC below.
    ('9ef12000-0000-4000-8000-000000000044', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000027', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-27', '{}'::jsonb),
    -- A mixed order whose worker finished while the cash leg still
    -- awaited its manual: verified provider money, an outstanding
    -- internal balance, and a completed side-effect row.
    ('9ef12000-0000-4000-8000-000000000045', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000034', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-34', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000046', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000034', 'refund', 100, 'NGN',
      'completed', 'paystack', 'pp-34-ok',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000045',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000047', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000034', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-34', '{}'::jsonb),
    -- A failed row never counts as coverage, but its ledger identifier
    -- still collides: the twin-race rescue reports the conflict.
    ('9ef12000-0000-4000-8000-000000000078', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000052', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-52', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000079', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000052', 'refund', 5, 'NGN',
      'failed', 'paystack', 'race-52#1', '{}'::jsonb);

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000001', 5,
      'Insufficient balance'),
    ('9ef11000-0000-4000-8000-000000000008', v_merchant_id, 'refund',
      'claimed', '9ef13000-0000-4000-8000-000000000008', 1, NULL),
    ('9ef11000-0000-4000-8000-000000000020', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000020', 0,
      'Insufficient balance'),
    ('9ef11000-0000-4000-8000-000000000034', v_merchant_id, 'refund',
      'completed', '9ef13000-0000-4000-8000-000000000034', 1, NULL);

  INSERT INTO public.customer_wallets (id, customer_id, merchant_id) VALUES
    ('9ef14000-0000-4000-8000-000000000001', v_customer_id, v_merchant_id);

  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id
  ) VALUES
    ('9ef14000-0000-4000-8000-000000000001', v_customer_id, v_merchant_id,
      'adjustment', 40, 40, 'order_reversal',
      '9ef11000-0000-4000-8000-000000000004'),
    ('9ef14000-0000-4000-8000-000000000001', v_customer_id, v_merchant_id,
      'adjustment', 40, 80, 'order_reversal',
      '9ef11000-0000-4000-8000-000000000006');

  UPDATE public.orders SET customer_id = v_customer_id
  WHERE id = '9ef11000-0000-4000-8000-000000000004';

  INSERT INTO public.order_items (order_id, product_id, name, price, quantity)
  VALUES ('9ef11000-0000-4000-8000-000000000004', v_product_id,
    'Refund Fixture Product', 100, 1);

  INSERT INTO public.customer_savings_redemptions (
    goal_id, merchant_id, customer_id, order_id, amount, idempotency_key,
    metadata
  ) VALUES (
    v_goal_id, v_merchant_id, v_customer_id,
    '9ef11000-0000-4000-8000-000000000004', 10, 'refund-fixture-004',
    '{"reversed_at":"2026-10-01T00:00:00Z"}'::jsonb
  );

  -- A long-pending refund accumulates audit events; the status response
  -- must bound them instead of growing every poll.
  INSERT INTO public.order_refund_events (order_id, merchant_id, action, created_at)
  SELECT '9ef11000-0000-4000-8000-000000000001', v_merchant_id, 'seed',
    pg_catalog.now() - (s || ' minutes')::interval
  FROM pg_catalog.generate_series(1, 60) AS s;

  -- The insert-boundary assertions below run as authenticated, so the
  -- table grants exist in-transaction (rolled back with the check): any
  -- rejection then comes from the WITH CHECK policy, not a missing grant.
  GRANT INSERT ON public.transactions TO authenticated;
  GRANT SELECT ON public.orders TO authenticated;
  GRANT SELECT ON public.order_cancellation_side_effects TO authenticated;
  CREATE POLICY refund_suite_probe_side_effects
    ON public.order_cancellation_side_effects FOR SELECT TO authenticated
    USING (true);
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_manager$
DECLARE
  v_result jsonb;
  v_rejected boolean;
  v_label text;
BEGIN
  -- Failed refunds are retryable, and a retry requeues exhausted work.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF NOT (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'failed refund is not retryable';
  END IF;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'expected remaining 100, got %', v_result->>'remaining';
  END IF;
  IF NOT (v_result->>'canManageRefunds')::boolean THEN
    RAISE EXCEPTION 'refund manager cannot manage refunds';
  END IF;

  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'manual', 101,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'excess-1',NULL,true);
    RAISE EXCEPTION 'excess refund accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_exceeds_remaining' THEN RAISE; END IF;
  END;

  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'retry'
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'retry did not requeue, got %', v_result->>'status';
  END IF;
  IF (v_result->>'retryRequests')::integer <> 1 THEN
    RAISE EXCEPTION 'retry request was not counted';
  END IF;

  -- Partial manual coverage disables retry: the worker's gateway
  -- matcher would quarantine the step and strand the balance.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 20,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-1',NULL,true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 80 THEN
    RAISE EXCEPTION 'partial refund did not reduce remaining';
  END IF;
  IF (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'retry still advertised after partial manual refund';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'retry');
    RAISE EXCEPTION 'retry accepted after partial manual refund';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'manual_completion_required' THEN RAISE; END IF;
  END;

  -- Replaying the identical manual record is idempotent, while a
  -- conflicting reuse of the reference is rejected.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 20,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-1',NULL,true
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'manual replay duplicated the ledger row';
  END IF;
  -- Replaying with a corrected note refreshes the annotation on the
  -- existing rows instead of recording new money or going stale.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 20,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-1', 'teller 4', true
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'note-corrected replay duplicated the ledger row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
      AND gateway_reference = 'partial-1#1'
      AND metadata->>'note' = 'teller 4'
  ) THEN
    RAISE EXCEPTION 'note correction not persisted on replay';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'manual', 25,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-1',NULL,true);
    RAISE EXCEPTION 'conflicting reference reuse accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'manual_reference_conflict' THEN RAISE; END IF;
  END;

  -- Recording attests money already moved: direct RPC callers must
  -- attest too, and the ledger row keeps the proof.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000001', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'unconfirmed-1', NULL, false);
    RAISE EXCEPTION 'unattested manual refund accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'refund_confirmation_required' THEN RAISE; END IF;
  END;
  PERFORM public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001', 'manual', 10,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'attested-1', NULL, true);
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE order_id = '9ef11000-0000-4000-8000-000000000001'
      AND gateway_reference = 'attested-1#1'
      AND metadata->>'confirmed' = 'true'
  ) THEN
    RAISE EXCEPTION 'merchant attestation not persisted on manual row';
  END IF;

  -- Claimed refunds block manual writes and management.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000008'
  ) INTO v_result;
  IF (v_result->>'canManageRefunds')::boolean THEN
    RAISE EXCEPTION 'claimed refund still manageable';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000008', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'claimed-1',NULL,true);
    RAISE EXCEPTION 'manual write accepted during claimed refund';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

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

  -- One manual transfer spans both legs with unique ledger identifiers
  -- while the merchant reference stays queryable on every leg.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000002', 'manual', 100,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'split-1',NULL,true
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 2 THEN
    RAISE EXCEPTION 'split manual did not span both legs';
  END IF;
  IF (v_result->>'remaining')::numeric <> 0 THEN
    RAISE EXCEPTION 'split manual did not clear remaining';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000002', 'manual', 100,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'split-1',NULL,true
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 2 THEN
    RAISE EXCEPTION 'split manual replay duplicated rows';
  END IF;

  -- Legacy refunded rows count as returned without blocking manual use,
  -- and provider rows without a merchant timestamp serialize ISO dates.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000003'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 30 THEN
    RAISE EXCEPTION 'legacy refunded row not counted as returned';
  END IF;
  IF (v_result->>'pending')::numeric <> 0 THEN
    RAISE EXCEPTION 'legacy refunded row counted as pending';
  END IF;
  IF (v_result->>'remaining')::numeric <> 70 THEN
    RAISE EXCEPTION 'legacy refunded row did not reduce remaining';
  END IF;
  IF NOT (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual unavailable beside legacy rows';
  END IF;
  IF (v_result->'history'->0->>'date') !~ '^\d{4}-\d{2}-\d{2}T' THEN
    RAISE EXCEPTION 'provider history date is not ISO-8601: %',
      v_result->'history'->0->>'date';
  END IF;

  -- Overlong padded references validate and store trimmed.
  PERFORM public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000003', 'manual', 10,
    '2026-09-28T12:00:00Z', 'bank_transfer',
    '  ' || pg_catalog.repeat('p', 100) || '  ',NULL,true);

  -- Wallet and savings reversals reduce the outstanding balance, and a
  -- reversal-adjusted manual completes the order.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000004'
  ) INTO v_result;
  IF (v_result->>'reversedInternal')::numeric <> 50 THEN
    RAISE EXCEPTION 'internal reversals not accounted';
  END IF;
  IF (v_result->>'remaining')::numeric <> 50 THEN
    RAISE EXCEPTION 'reversed money still outstanding';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000004', 'manual', 51,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'over-after-reversal',NULL,true);
    RAISE EXCEPTION 'manual exceeded reversal-adjusted remaining';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_exceeds_remaining' THEN RAISE; END IF;
  END;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000004', 'manual', 50,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'reversal-adjusted',NULL,true
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'reversal-adjusted manual did not requeue, got %',
      v_result->>'status';
  END IF;

  -- Unlinked completed refunds block manual allocation for review.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000005', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'unlinked-1',NULL,true);
    RAISE EXCEPTION 'manual accepted beside unallocated refund';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'unallocated_refund_requires_review' THEN RAISE; END IF;
  END;

  -- A sole-leg unlinked refund still attributes like the claim gate.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000005'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 10
    OR (v_result->>'pending')::numeric <> 0
    OR (v_result->>'remaining')::numeric <> 90 THEN
    RAISE EXCEPTION 'sole unlinked row misattributed, got %/%/%',
      v_result->>'refunded', v_result->>'pending', v_result->>'remaining';
  END IF;

  -- Manual money skips already-reversed wallet legs: only the Paystack
  -- leg is allocatable, so one row covers the outstanding 60.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000006'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 60 THEN
    RAISE EXCEPTION 'split-internal remaining wrong, got %',
      v_result->>'remaining';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000006', 'manual', 61,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'internal-over',NULL,true);
    RAISE EXCEPTION 'manual exceeded split-internal remaining';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_exceeds_remaining' THEN RAISE; END IF;
  END;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000006', 'manual', 60,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'internal-1',NULL,true
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'manual allocated to the reversed wallet leg';
  END IF;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'split-internal manual did not requeue, got %',
      v_result->>'status';
  END IF;

  -- A wallet-only order has no allocatable leg: the wallet path owns
  -- the reversal, so manual recording surfaces for review.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000007', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'wallet-only-1',NULL,true);
    RAISE EXCEPTION 'manual allocated to a wallet-only order';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;

  -- Legacy currency casing passes; genuinely foreign legs block.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000010', 'manual', 100,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'lower-1',NULL,true
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'lowercase currency manual did not requeue, got %',
      v_result->>'status';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000011', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'usd-1',NULL,true);
    RAISE EXCEPTION 'manual accepted on foreign-currency leg';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_currency_requires_review' THEN RAISE; END IF;
  END;

  -- A concurrent twin racing the same merchant reference slips past
  -- the idempotency check and collides mid-allocation: the rescue
  -- reports the reference conflict instead of a raw unique violation.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000052', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'race-52',NULL,true);
    RAISE EXCEPTION 'racing reference accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'manual_reference_conflict' THEN RAISE; END IF;
  END;

  -- The failed row above never counts as coverage or pending.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000052'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'remaining')::numeric <> 100
    OR (v_result->>'pending')::numeric <> 0 THEN
    RAISE EXCEPTION 'failed row counted, refunded % remaining % pending %',
      v_result->>'refunded', v_result->>'remaining', v_result->>'pending';
  END IF;

  -- Corrupt links never count as coverage, but they hold pending: a
  -- completed row claiming another order's leg is excluded from the
  -- remainder and cannot flip the payment label, while recording
  -- beside it stays blocked until reconciliation (the row may be
  -- real provider money under a malformed link — recording past it
  -- would double-pay).
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000017'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'remaining')::numeric <> 100
    OR (v_result->>'pending')::numeric <> 100 THEN
    RAISE EXCEPTION 'corrupt link miscounted, refunded % remaining % pending %',
      v_result->>'refunded', v_result->>'remaining', v_result->>'pending';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000017';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'corrupt link flipped payment label to %', v_label;
  END IF;

  -- Recording beside the corrupt link stays blocked, and the block
  -- precedes any side-effect write: no claimable row is created.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000017', 'manual', 100,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'norow-1',NULL,true);
    RAISE EXCEPTION 'manual accepted beside a corrupt link';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;
  IF EXISTS (
    SELECT 1 FROM public.order_cancellation_side_effects
    WHERE order_id = '9ef11000-0000-4000-8000-000000000017'
      AND step = 'refund'
  ) THEN
    RAISE EXCEPTION 'blocked manual created a claimable row';
  END IF;

  -- Legacy rows without a cancellation timestamp route to review: the
  -- trusted finalization cannot run without one.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000012', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'legacy-1',NULL,true);
    RAISE EXCEPTION 'manual accepted without cancellation timestamp';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;

  -- Self-terminal payment legs count toward their side: a refunded
  -- PayPal leg is returned money, an in-flight one blocks recording.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000013'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 100 THEN
    RAISE EXCEPTION 'refunded payment leg not counted as returned';
  END IF;
  IF (v_result->>'remaining')::numeric <> 0 THEN
    RAISE EXCEPTION 'refunded payment leg still outstanding';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual offered on a self-terminally refunded order';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000014'
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 100 THEN
    RAISE EXCEPTION 'in-flight payment leg not counted as pending';
  END IF;
  IF v_result->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'in-flight payment leg not processing';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual offered beside an in-flight payment leg';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000014', 'manual', 10,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'inflight-1',NULL,true);
    RAISE EXCEPTION 'manual accepted beside an in-flight payment leg';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

  -- Foreign-currency refund rows stay visible but out of coverage,
  -- and block recording until reconciliation: the manager cannot
  -- convert money, so an unexplained linked row leaves the full
  -- balance owed but not recordable (recording beside it would
  -- double-record if the row turns out to be matching money).
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000015'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0 THEN
    RAISE EXCEPTION 'foreign-currency row counted as returned';
  END IF;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'foreign-currency row reduced remaining';
  END IF;
  IF (v_result->>'pending')::numeric <> 30 THEN
    RAISE EXCEPTION 'foreign-currency row not held pending, got %',
      v_result->>'pending';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual recordable beside unreconciled foreign money';
  END IF;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 1 THEN
    RAISE EXCEPTION 'foreign-currency row hidden from history';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000015', 'manual', 100,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'fx-cover',NULL,true
    );
    RAISE EXCEPTION 'manual accepted beside unreconciled foreign money';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

  -- An unverified Paystack row is in-flight, not returned: it must
  -- not reduce the remainder (the claim still sees the leg
  -- uncovered), must keep the payment label paid, and must block
  -- manual recording instead of leaving room for a double-record.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000018'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'pending')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'unverified row miscounted, got %/%/%',
      v_result->>'refunded', v_result->>'pending', v_result->>'remaining';
  END IF;
  IF v_result->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'unverified row did not hold processing status';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual recordable beside unverified provider money';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000018';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'unverified row flipped payment label to %', v_label;
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000018', 'manual', 100,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'unverified-1',NULL,true);
    RAISE EXCEPTION 'manual accepted beside unverified provider money';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

  -- A cash-only cancellation records and finalizes with no external
  -- leg: the full manual creates the claimable row the claim guard
  -- admits on manual coverage alone.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000019'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'cash leg missing from remaining, got %',
      v_result->>'remaining';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000019', 'manual', 100,
    '2026-09-28T12:00:00Z', 'cash', 'cashonly-1',NULL,true
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'cash-only manual did not requeue, got %',
      v_result->>'status';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_cancellation_side_effects
    WHERE order_id = '9ef11000-0000-4000-8000-000000000019'
      AND step = 'refund' AND status = 'failed' AND attempts = 0
  ) THEN
    RAISE EXCEPTION 'cash-only manual did not create a claimable row';
  END IF;

  -- A mixed cancellation keeps its outstanding cash balance: the
  -- verified provider money counts, the cash leg stays allocatable,
  -- and the claim below must wait for the merchant, not finalize.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000020'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 60
    OR (v_result->>'remaining')::numeric <> 40 THEN
    RAISE EXCEPTION 'mixed cash balance wrong, got %/%',
      v_result->>'refunded', v_result->>'remaining';
  END IF;
  -- The status response masks the failed step's raw worker error
  -- (direct REST callers bypass the route) and derives no Paystack
  -- signal from a provider-less message.
  IF v_result->>'error'
    <> 'The refund ran into a problem. Support has the details.' THEN
    RAISE EXCEPTION 'status response leaked raw worker text: %',
      v_result->>'error';
  END IF;
  IF (v_result->>'needsPaystackCheck')::boolean THEN
    RAISE EXCEPTION 'paystack signal derived from a provider-less error';
  END IF;

  -- An overfunded ledger routes manuals to review: the leg exceeds
  -- the recorded balance, so the remainder could never cover it and
  -- recording would strand finalization with a zero balance.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000021'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'overfunded remaining wrong, got %',
      v_result->>'remaining';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000021', 'manual', 100,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'overfunded-1',NULL,true);
    RAISE EXCEPTION 'manual accepted on an overfunded ledger';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;

  -- An unlinked refund across several legs waits in pending: it is
  -- neither whole-order coverage nor a flipped label, and manuals
  -- stay blocked until operations links it.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000022'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'pending')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'multi-leg unlinked row miscounted, got %/%/%',
      v_result->>'refunded', v_result->>'pending', v_result->>'remaining';
  END IF;
  IF v_result->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'multi-leg unlinked row did not hold processing status';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000022';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'multi-leg unlinked row flipped payment label to %',
      v_label;
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000022', 'manual', 100,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'multileg-1',NULL,true);
    RAISE EXCEPTION 'manual accepted beside multi-leg unlinked money';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;

  -- Sole-leg attribution still requires the claim's gateway match:
  -- a foreign-gateway row and an unlinked manual row both wait in
  -- pending without flipping the label.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000023'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'pending')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'foreign-gateway row misattributed, got %/%/%',
      v_result->>'refunded', v_result->>'pending', v_result->>'remaining';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000023';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'foreign-gateway row flipped payment label to %', v_label;
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000024'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'pending')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'unlinked manual row misattributed, got %/%/%',
      v_result->>'refunded', v_result->>'pending', v_result->>'remaining';
  END IF;

  -- The overfunded guard compares against the live remainder: partial
  -- coverage of 20 leaves 80 recordable against 90 outstanding, so
  -- recording would strand finalization with a zero balance.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000025', 'manual', 80,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'overfunded-partial',NULL,true);
    RAISE EXCEPTION 'manual accepted on a partially covered overfunded leg';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;

  -- A linked row from another gateway is not coverage: the claim
  -- rejects the mismatch, so it waits in pending with the label
  -- held and manual recording blocked until review.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000026'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'pending')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'cross-gateway row misattributed, got %/%/%',
      v_result->>'refunded', v_result->>'pending', v_result->>'remaining';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'manual allowed beside cross-gateway evidence';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000026';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'cross-gateway row flipped payment label to %', v_label;
  END IF;
  -- Per-leg coverage assertions (028+) live in
  -- order_refund_management_per_leg_coverage.sql.

  -- A full manual declared as a direct Paystack refund records but
  -- stays in-flight without provider confirmation: the response is
  -- processing (pending, recording blocked) and the order label
  -- stays paid — never refunded while the claim still sees the
  -- leg uncovered. The claim test below asserts it defers to the
  -- worker instead.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000027', 'manual', 100,
    '2026-09-28T12:00:00Z', 'paystack', 'direct-paystack-1', NULL, true
  ) INTO v_result;
  IF v_result->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'unverified paystack manual not processing, got %',
      v_result->>'status';
  END IF;
  IF (v_result->>'pending')::numeric <> 100 THEN
    RAISE EXCEPTION 'unverified paystack manual pending = %, want 100',
      v_result->>'pending';
  END IF;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'unverified paystack manual remaining = %, want 100',
      v_result->>'remaining';
  END IF;
  IF (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'unverified paystack manual allows double-record';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000027';
  IF v_label = 'refunded' THEN
    RAISE EXCEPTION 'unverified paystack manual flipped the order label';
  END IF;

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

  -- Audit history stays bounded no matter how long a refund pends.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'events') <> 50 THEN
    RAISE EXCEPTION 'refund events unbounded, got %',
      pg_catalog.jsonb_array_length(v_result->'events');
  END IF;
END;
$refund_manager$;

-- Refund history stays bounded: bulk ledger rows cap the payload at
-- 50 like the audit events.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_history_bulk$
BEGIN
  INSERT INTO public.transactions
    (merchant_id, order_id, transaction_type, amount, currency, status,
     gateway, gateway_reference, metadata)
  SELECT '9ef10100-0000-4000-8000-000000000001',
    '9ef11000-0000-4000-8000-000000000017', 'refund', 1, 'NGN', 'completed',
    'manual', 'bulk-' || g || '#1',
    jsonb_build_object(
      'payment_transaction_id', '9ef12000-0000-4000-8000-000000000023',
      'reference', 'bulk-' || g)
  FROM pg_catalog.generate_series(1, 55) g;
END;
$refund_history_bulk$;

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

-- Round-33 fixtures: partial-first manual (035), review precedence
-- with pending (038) and with full coverage (039), and the
-- null-currency self-terminal trigger order (040). Isolated orders
-- no other block touches.
DO $refund_round33_fixtures$
DECLARE
  v_label text;
BEGIN
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000035',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-035',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000038',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-038',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000039',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-039',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000040',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-040',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000041',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-041',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000042',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-042',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000043',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-043',
      200, 200, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000044',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-044',
      200, 200, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000045',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-045',
      200, 200, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000046',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-046',
      200, 200, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000047',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-047',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000048',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-048',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000049',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-049',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000050',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-050',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000051',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-051',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000053',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-053',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000054',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-054',
      100, 100, 'paid', 'cancelled', pg_catalog.now());
  -- Legacy null-currency order: its NGN leg still prices in NGN.
  UPDATE public.orders SET currency = NULL
  WHERE id = '9ef11000-0000-4000-8000-000000000040';
  -- Legacy missing-timestamp order: cancelled and paid, but the
  -- aggregate finalizer rejects a NULL cancelled_at.
  UPDATE public.orders SET cancelled_at = NULL
  WHERE id = '9ef11000-0000-4000-8000-000000000041';
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000048',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000035', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-35', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000049',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000038', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-38', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000050',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000038', 'refund', 100, 'NGN',
      'completed', 'manual', 'm-38#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000049',
        'method', 'paystack', 'reference', 'm-38')),
    ('9ef12000-0000-4000-8000-000000000051',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000039', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-39', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000052',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000039', 'refund', 100, 'NGN',
      'completed', 'paystack', '777001',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000051',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000053',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000040', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-40', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000054',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000041', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-41', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000055',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000042', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-42', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000056',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000042', 'refund', 100, 'NGN',
      'completed', 'paystack', '777002',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000055',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000057',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000043', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-43a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000058',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000043', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-43b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000059',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000044', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-44a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000060',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000044', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-44b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000061',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000045', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-45a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000062',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000045', 'payment', 100, 'NGN',
      'completed', 'korapay', 'kp-45b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000063',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000046', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-46a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000064',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000046', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-46b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000065',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000046', 'refund', 100, 'NGN',
      'completed', 'paystack', '777065',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000063',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000066',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000047', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-47a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000067',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000047', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-47b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000068',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000048', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-48a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000069',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000048', 'refund', 100, 'NGN',
      'completed', 'paystack', '777048',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000068',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000070',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000048', 'refund', 100, 'NGN',
      'completed', 'manual', 'claim-48#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000068',
        'method', 'paystack',
        'recorded_by', '9ef10100-0000-4000-8000-000000000001')),
    -- Two full captures against one recorded payment: the first
    -- capture's processed refund must not erase the live
    -- capture's gap via order-wide excess.
    ('9ef12000-0000-4000-8000-000000000071',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000049', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-49a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000072',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000049', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-49b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000073',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000049', 'refund', 100, 'NGN',
      'completed', 'paystack', '777049',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000071',
        'provider_refund_status', 'processed')),
    -- A lone capture with no side-effect row: a partial Paystack
    -- attestation must still requeue verification for it.
    ('9ef12000-0000-4000-8000-000000000074',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000050', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-50', '{}'::jsonb),
    -- A covered leg with anomalous extra evidence: the processed
    -- Paystack row covers the leg, but the linked completed
    -- Korapay row must still block aggregate finalization like
    -- the manager's pending gate.
    ('9ef12000-0000-4000-8000-000000000075',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000051', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-51', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000076',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000051', 'refund', 100, 'NGN',
      'completed', 'paystack', '777051',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000075',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000077',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000051', 'refund', 100, 'NGN',
      'completed', 'korapay', 'kp-51',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000075')),
    -- A foreign-currency capture that self-terminalized: the refunded
    -- leg prices in different money, so neither the label nor the
    -- aggregate claim may treat it as returned.
    ('9ef12000-0000-4000-8000-000000000080',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000053', 'payment', 100, 'USD',
      'completed', 'paystack', 'pp-53', '{}'::jsonb),
    -- A wallet-only cancellation reversed through the internal
    -- ledger: no refund rows, no side-effect row — the status read
    -- itself must persist the terminal label.
    ('9ef12000-0000-4000-8000-000000000081',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000054', 'payment', 100, 'NGN',
      'completed', 'wallet', 'w-54', '{}'::jsonb);
  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000035',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000035', 5,
      'Paystack/timeout (acquirer 91)'),
    ('9ef11000-0000-4000-8000-000000000038',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'delivery_uncertain', '9ef13000-0000-4000-8000-000000000038', 5,
      'Manual Paystack refunds exceed provider-confirmed amounts; review required'),
    ('9ef11000-0000-4000-8000-000000000039',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'delivery_uncertain', '9ef13000-0000-4000-8000-000000000039', 5,
      'An existing Paystack refund requires reconciliation before retry'),
    ('9ef11000-0000-4000-8000-000000000041',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000041', 5,
      'Insufficient balance'),
    ('9ef11000-0000-4000-8000-000000000042',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000042', 5,
      'settlement_wallet_missing');
  -- A null-currency order's self-terminal NGN leg flips the label:
  -- without the NGN default the currency comparison is NULL and
  -- the leg never counts.
  UPDATE public.transactions SET status = 'refunded'
  WHERE id = '9ef12000-0000-4000-8000-000000000053';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000040';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'null-currency self-terminal leg did not flip label, got %',
      v_label;
  END IF;
  -- A self-terminal leg with a linked terminal refund row counts
  -- once (payment side), not twice: the sibling leg is still
  -- uncovered, so the label must stay paid.
  UPDATE public.transactions SET status = 'refunded'
  WHERE id = '9ef12000-0000-4000-8000-000000000063';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000046';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'self-terminal double count flipped label, got %',
      v_label;
  END IF;
  -- Superseded capture: the obsolete leg's reversal already matches
  -- amount_paid while the live capture sits outstanding. Neither the
  -- label nor the remainder may treat the order as refunded.
  UPDATE public.transactions SET status = 'refunded'
  WHERE id = '9ef12000-0000-4000-8000-000000000066';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000047';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'superseded capture flipped label, got %', v_label;
  END IF;
  -- Two full captures against one recorded payment: the covered
  -- capture's refund matches amount_paid, but the live capture's
  -- gap keeps the label paid — order-wide excess must not erase
  -- an identified per-leg gap.
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000049';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'live-capture gap erased by excess, got %', v_label;
  END IF;
  -- A foreign-currency capture that self-terminalizes is not
  -- returned money: the label must not flip on the transition.
  UPDATE public.transactions SET status = 'refunded'
  WHERE id = '9ef12000-0000-4000-8000-000000000080';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000053';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'foreign-currency leg flipped label, got %', v_label;
  END IF;
  -- The wallet-only order reverses through the internal ledger
  -- (reusing the main-block wallet and customer).
  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id
  ) VALUES (
    '9ef14000-0000-4000-8000-000000000001',
    '9ef10200-0000-4000-8000-000000000001',
    '9ef10100-0000-4000-8000-000000000001', 'adjustment', 100, 180,
    'order_reversal', '9ef11000-0000-4000-8000-000000000054');
END;
$refund_round33_fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_round33_status$
DECLARE
  v_result jsonb;
  v_label text;
  v_attempts integer;
BEGIN
  -- The self-terminal leg's linked row counts once: the manager
  -- still owes the uncovered sibling leg.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000046'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100
    OR (v_result->>'refunded')::numeric <> 100 THEN
    RAISE EXCEPTION 'self-terminal leg double counted, refunded % remaining %',
      v_result->>'refunded', v_result->>'remaining';
  END IF;
  -- The superseded capture's reversal matches amount_paid, but the
  -- live capture is still owed: recording stays open.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000047'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100
    OR NOT (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'superseded capture stranded, remaining % recordable %',
      v_result->>'remaining', v_result->>'canRecordManual';
  END IF;
  -- Two full captures against one recorded payment: the live
  -- capture's gap keeps the full remainder recordable, and
  -- covering it finishes the order.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000049'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100
    OR NOT (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'live-capture gap erased, remaining % recordable %',
      v_result->>'remaining', v_result->>'canRecordManual';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000049', 'manual', 100,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'live-capture-49', NULL, true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 0 THEN
    RAISE EXCEPTION 'live-capture manual left remaining %',
      v_result->>'remaining';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000049';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'covered live capture did not flip label, got %',
      v_label;
  END IF;
  -- A partial Paystack attestation requeues verification even with a
  -- balance left: the claim counts as pending (blocking further
  -- records), so without a selectable side-effect row no worker
  -- would ever verify it.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000050', 'manual', 30,
    '2026-09-28T12:00:00Z', 'paystack', 'verify-queue-50', NULL, true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100
    OR (v_result->>'pending')::numeric <> 30 THEN
    RAISE EXCEPTION 'partial paystack attestation miscounted, remaining % pending %',
      v_result->>'remaining', v_result->>'pending';
  END IF;
  SELECT status, attempts INTO v_label, v_attempts
    FROM public.order_cancellation_side_effects
   WHERE order_id = '9ef11000-0000-4000-8000-000000000050'
     AND step = 'refund';
  IF NOT FOUND OR v_label <> 'failed' OR v_attempts <> 0 THEN
    RAISE EXCEPTION 'partial paystack attestation not requeued, %/%',
      v_label, v_attempts;
  END IF;
  -- Recording stays blocked until the worker verifies the claim.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000050', 'manual', 30,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'verify-blocked-50', NULL, true);
    RAISE EXCEPTION 'manual accepted beside unverified paystack claim';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;
  -- A cross-gateway row beside a covered leg holds the manager
  -- pending: the claim test below asserts the aggregate gate
  -- agrees instead of finalizing past it.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000051'
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 100 THEN
    RAISE EXCEPTION 'cross-gateway row not held pending, got %',
      v_result->>'pending';
  END IF;
  -- A self-terminalized foreign-currency leg holds the full
  -- remainder: the claim test below asserts the aggregate gate
  -- agrees instead of finalizing unvalidated money.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000053'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'foreign-currency leg reduced remainder, got %',
      v_result->>'remaining';
  END IF;
  -- Internal-only reversals persist the terminal label on read: with
  -- no refund ledger rows the sync trigger never fires, so the
  -- status call itself must persist refunded instead of exposing a
  -- label a refresh would revert.
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000054';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'internal-only order pre-flipped, got %', v_label;
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000054'
  ) INTO v_result;
  IF v_result->>'status' <> 'refunded' THEN
    RAISE EXCEPTION 'internal-only reversal not terminal, got %',
      v_result->>'status';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000054';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'internal-only label not persisted, got %', v_label;
  END IF;
  -- A first manual record that leaves a balance behind is partial in
  -- the same response: the panel must not advertise a retry the
  -- next call rejects until the next poll.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000035', 'manual', 30,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'partial-first-35', NULL, true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 70 THEN
    RAISE EXCEPTION 'partial-first manual left remaining %',
      v_result->>'remaining';
  END IF;
  IF (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'retry advertised in the partial-first response';
  END IF;
  -- The status response carries fixed labels, never raw worker
  -- text, with the Paystack review signal as structured data.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000035'
  ) INTO v_result;
  IF v_result->>'error'
    <> 'The refund ran into a problem. Support has the details.'
    OR v_result->>'error' LIKE '%Paystack%' THEN
    RAISE EXCEPTION 'status response leaked raw worker text: %',
      v_result->>'error';
  END IF;
  IF NOT (v_result->>'needsPaystackCheck')::boolean THEN
    RAISE EXCEPTION 'paystack signal missing for a provider error';
  END IF;
  -- Terminal quarantine reports review before pending evidence:
  -- the drain never resumes these rows.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000038'
  ) INTO v_result;
  IF v_result->>'status' <> 'requires_review' THEN
    RAISE EXCEPTION 'quarantined pending order reports %, want requires_review',
      v_result->>'status';
  END IF;
  IF v_result->>'error'
    <> 'This refund needs review before it can continue.' THEN
    RAISE EXCEPTION 'review error mislabeled: %', v_result->>'error';
  END IF;
  -- ... and before full coverage: an open terminal review stays
  -- visible even once the money lands.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000039'
  ) INTO v_result;
  IF v_result->>'status' <> 'requires_review' THEN
    RAISE EXCEPTION 'quarantined covered order reports %, want requires_review',
      v_result->>'status';
  END IF;
  -- A cancelled order without a cancellation timestamp rejects both
  -- actions: the aggregate finalizer requires cancelled_at, so
  -- rearming would move provider money and then strand settlement
  -- reversal and notifications.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000041', 'retry');
    RAISE EXCEPTION 'retry accepted without a cancellation timestamp';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000041', 'manual', 100,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'no-ts-41', NULL, true);
    RAISE EXCEPTION 'manual accepted without a cancellation timestamp';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;
  -- Full coverage with a failed finalize reports failed (not
  -- refunded) and stays retryable: rearming reruns trusted
  -- finalization, the only recovery when the claim rolled back.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000042'
  ) INTO v_result;
  IF v_result->>'status' <> 'failed' THEN
    RAISE EXCEPTION 'failed finalize reports %, want failed',
      v_result->>'status';
  END IF;
  IF NOT (v_result->>'canRetry')::boolean THEN
    RAISE EXCEPTION 'failed finalize is not retryable';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000042', 'retry'
  ) INTO v_result;
  IF (v_result->>'retryRequests')::integer <> 1 THEN
    RAISE EXCEPTION 'finalize rerun was not counted';
  END IF;
  -- A Paystack attestation without a leg pin routes to review when
  -- several external legs still need money: FIFO would link the
  -- wrong capture and verification would quarantine a valid refund.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000043', 'manual', 100,
      '2026-09-28T12:00:00Z', 'paystack', 'ambiguous-43', NULL, true);
    RAISE EXCEPTION 'ambiguous paystack record was FIFO-linked';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment_ledger_requires_review' THEN RAISE; END IF;
  END;
  -- The status response names the pin candidates: both captures
  -- with their outstanding amounts, oldest first.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000043'
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'legs') <> 2
    OR v_result->'legs'->0->>'id' <> '9ef12000-0000-4000-8000-000000000057'
    OR (v_result->'legs'->0->>'outstanding')::numeric <> 100
    OR v_result->'legs'->1->>'id' <> '9ef12000-0000-4000-8000-000000000058'
    OR (v_result->'legs'->1->>'outstanding')::numeric <> 100 THEN
    RAISE EXCEPTION 'pin candidates mislisted: %', v_result->'legs';
  END IF;
  -- A pin to a missing leg is rejected as invalid input.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000043', 'manual', 100,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'bad-pin-43', NULL, true,
      p_payment_transaction_id => 'ffffffff-0000-4000-8000-000000000000');
    RAISE EXCEPTION 'dangling leg pin was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid_manual_refund' THEN RAISE; END IF;
  END;
  -- A paystack attestation larger than its pinned leg is rejected:
  -- attestations never spill across captures.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000043', 'manual', 150,
      '2026-09-28T12:00:00Z', 'paystack', 'over-pin-43', NULL, true,
      p_payment_transaction_id => '9ef12000-0000-4000-8000-000000000057');
    RAISE EXCEPTION 'oversized pinned attestation was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_exceeds_remaining' THEN RAISE; END IF;
  END;
  -- A pinned Paystack attestation lands on its leg as in-flight
  -- money: the claim pends provider verification, so the balance
  -- stays open while pending carries it (link asserted below).
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000043', 'manual', 100,
    '2026-09-28T12:00:00Z', 'paystack', 'pin-2', NULL, true,
    p_payment_transaction_id => '9ef12000-0000-4000-8000-000000000058'
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 200 THEN
    RAISE EXCEPTION 'pinned attestation left pending % remaining %',
      v_result->>'pending', v_result->>'remaining';
  END IF;
  -- The covered leg drops out of the pin candidates.
  IF pg_catalog.jsonb_array_length(v_result->'legs') <> 1
    OR v_result->'legs'->0->>'id' <> '9ef12000-0000-4000-8000-000000000057' THEN
    RAISE EXCEPTION 'covered leg still listed: %', v_result->'legs';
  END IF;
  -- The unverified attestation pends further records until the
  -- provider confirms it: the processing guard layers over the pin.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000043', 'manual', 100,
      '2026-09-28T12:00:00Z', 'paystack', 'pin-1', NULL, true,
      p_payment_transaction_id => '9ef12000-0000-4000-8000-000000000057');
    RAISE EXCEPTION 'second pin slipped past pending evidence';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;
  -- A non-paystack pin allocates pinned-first, then spills FIFO.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000044', 'manual', 150,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'spill-1', NULL, true,
    p_payment_transaction_id => '9ef12000-0000-4000-8000-000000000060'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 50 THEN
    RAISE EXCEPTION 'spillover record left remaining %', v_result->>'remaining';
  END IF;
  -- A sole outstanding external leg pins itself: no review, no
  -- guess. The attestation still pends verification beside the 30
  -- already covered (link asserted below).
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000035', 'manual', 70,
    '2026-09-28T12:00:00Z', 'paystack', 'implicit-pin-35', NULL, true
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 70
    OR (v_result->>'remaining')::numeric <> 70 THEN
    RAISE EXCEPTION 'implicit pin left pending % remaining %',
      v_result->>'pending', v_result->>'remaining';
  END IF;
  -- A Paystack attestation pinned to a non-Paystack leg is
  -- invalid: preflight cannot verify it, so recording it would
  -- only quarantine the refund later.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000045', 'manual', 50,
      '2026-09-28T12:00:00Z', 'paystack', 'korapay-pin-45', NULL, true,
      p_payment_transaction_id => '9ef12000-0000-4000-8000-000000000062');
    RAISE EXCEPTION 'paystack pin to a korapay leg was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid_manual_refund' THEN RAISE; END IF;
  END;
  -- The implicit pin skips the Korapay leg: the sole Paystack
  -- capture resolves even beside other gateways, and the
  -- candidate list names it alone.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000045', 'manual', 50,
    '2026-09-28T12:00:00Z', 'paystack', 'implicit-45', NULL, true
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 50
    OR (v_result->>'remaining')::numeric <> 200 THEN
    RAISE EXCEPTION 'implicit paystack pin left pending % remaining %',
      v_result->>'pending', v_result->>'remaining';
  END IF;
  IF pg_catalog.jsonb_array_length(v_result->'legs') <> 1
    OR v_result->'legs'->0->>'id' <> '9ef12000-0000-4000-8000-000000000061' THEN
    RAISE EXCEPTION 'korapay leg listed as a pin candidate: %',
      v_result->'legs';
  END IF;
END;
$refund_round33_status$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_round36_links$
DECLARE
  v_link text;
  v_count integer;
BEGIN
  -- The pinned row links its named leg.
  SELECT metadata->>'payment_transaction_id' INTO v_link
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000043'
  AND gateway_reference = 'pin-2#1';
  IF v_link <> '9ef12000-0000-4000-8000-000000000058' THEN
    RAISE EXCEPTION 'pin-2 linked %, want leg 058', v_link;
  END IF;
  -- The spillover split pinned-first: 100 to leg 060, 50 to leg 059.
  SELECT COUNT(*) INTO v_count FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000044'
  AND gateway_reference = 'spill-1#1'
  AND metadata->>'payment_transaction_id' = '9ef12000-0000-4000-8000-000000000060'
  AND amount = 100;
  IF v_count <> 1 THEN RAISE EXCEPTION 'spillover first slice mislinked'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000044'
  AND gateway_reference = 'spill-1#2'
  AND metadata->>'payment_transaction_id' = '9ef12000-0000-4000-8000-000000000059'
  AND amount = 50;
  IF v_count <> 1 THEN RAISE EXCEPTION 'spillover second slice mislinked'; END IF;
  -- The implicit pin resolved to the sole outstanding leg.
  SELECT metadata->>'payment_transaction_id' INTO v_link
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000035'
  AND gateway_reference = 'implicit-pin-35#1';
  IF v_link <> '9ef12000-0000-4000-8000-000000000048' THEN
    RAISE EXCEPTION 'implicit pin linked %, want leg 048', v_link;
  END IF;
  -- The cross-gateway implicit pin skipped the Korapay leg.
  SELECT metadata->>'payment_transaction_id' INTO v_link
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000045'
  AND gateway_reference = 'implicit-45#1';
  IF v_link <> '9ef12000-0000-4000-8000-000000000061' THEN
    RAISE EXCEPTION 'cross-gateway pin linked %, want leg 061', v_link;
  END IF;
  -- Stamping provider proof reassigns the same status to refire the
  -- label sync: the audit must not log the record twice.
  UPDATE public.transactions
     SET status = status,
         metadata = metadata || '{"provider_refund_status":"processed"}'::jsonb
   WHERE order_id = '9ef11000-0000-4000-8000-000000000035'
     AND gateway_reference = 'implicit-pin-35#1';
  SELECT count(*) INTO v_count FROM public.order_refund_events
   WHERE order_id = '9ef11000-0000-4000-8000-000000000035'
     AND action = 'manual_recorded';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'proof stamp duplicated the audit, got % events', v_count;
  END IF;
END;
$refund_round36_links$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_history_bound$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000017'
  ) INTO v_result;
  IF pg_catalog.jsonb_array_length(v_result->'history') <> 50 THEN
    RAISE EXCEPTION 'refund history unbounded, got %',
      pg_catalog.jsonb_array_length(v_result->'history');
  END IF;
END;
$refund_history_bound$;

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
      '2026-09-28T12:00:00Z', 'bank_transfer', 'staff-1',NULL,true);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := SQLERRM = 'refund_forbidden';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'view-authorized staff recorded a manual refund';
  END IF;
END;
$refund_viewer$;

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

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000001',
  true
);

DO $refund_owner$
DECLARE
  v_result jsonb;
  v_event_count integer;
BEGIN
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF NOT (v_result->>'canManageRefunds')::boolean THEN
    RAISE EXCEPTION 'owner cannot manage refunds';
  END IF;

  -- Owners read the audit trail but cannot forge entries.
  SELECT count(*) INTO v_event_count FROM public.order_refund_events;
  IF v_event_count = 0 THEN
    RAISE EXCEPTION 'owner sees no refund audit events';
  END IF;
  BEGIN
    INSERT INTO public.order_refund_events (order_id, merchant_id, action)
    VALUES ('9ef11000-0000-4000-8000-000000000001',
      '9ef10100-0000-4000-8000-000000000001', 'forged');
    RAISE EXCEPTION 'direct audit write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Refund rows enter the ledger only through the RPC: authenticated
  -- direct inserts are rejected while linked payments still pass.
  BEGIN
    INSERT INTO public.transactions (
      merchant_id, order_id, transaction_type, amount, currency,
      status, gateway
    ) VALUES ('9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000001', 'refund', 10, 'NGN',
      'completed', 'manual');
    RAISE EXCEPTION 'authenticated refund insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO public.transactions (
    merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference
  ) VALUES ('9ef10100-0000-4000-8000-000000000001',
    '9ef11000-0000-4000-8000-000000000001', 'payment', 10, 'NGN',
    'completed', 'paystack', 'policy-pay-1');
  -- Refund-state payment rows are trusted-provider territory: forged
  -- legs would poison the pending aggregate or the sync trigger.
  BEGIN
    INSERT INTO public.transactions (
      merchant_id, order_id, transaction_type, amount, currency,
      status, gateway, gateway_reference
    ) VALUES ('9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000001', 'payment', 10, 'NGN',
      'refunded', 'paystack', 'policy-forge-1');
    RAISE EXCEPTION 'forged refunded payment insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.transactions (
      merchant_id, order_id, transaction_type, amount, currency,
      status, gateway, gateway_reference
    ) VALUES ('9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000001', 'payment', 10, 'NGN',
      'refund_pending', 'paystack', 'policy-forge-2');
    RAISE EXCEPTION 'forged refund-pending payment insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.transactions (
      merchant_id, order_id, transaction_type, amount, currency,
      status, gateway
    ) VALUES ('9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000009', 'payment', 10, 'NGN',
      'completed', 'paystack');
    RAISE EXCEPTION 'cross-merchant order linkage allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$refund_owner$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_claim_finalize$
DECLARE
  v_won boolean;
  v_status text;
  v_label text;
  v_result jsonb;
BEGIN
  -- A fully manual refund routes through the trusted aggregate
  -- finalization: the next claim sees manual-row coverage and runs
  -- settlement reversal, notifications, and review close.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000002', 'refund',
    '9ef13000-0000-4000-8000-000000000002');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'full manual coverage did not finalize, got %', v_status;
  END IF;
  -- A partial manual refund leaves the legs uncovered for the worker.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000001', 'refund',
    '9ef13000-0000-4000-8000-000000000001');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'partial manual coverage finalized early, got %', v_status;
  END IF;
  -- A legacy refunded row is terminal evidence like a completed one:
  -- full coverage finalizes instead of running the worker.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000016', 'refund',
    '9ef13000-0000-4000-8000-000000000016');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'refunded-row coverage did not finalize, got %', v_status;
  END IF;
  -- A corrupt link routes to the worker instead of finalizing: the
  -- claim takes the worker branch (where the executor quarantines
  -- the row for reconciliation) rather than completing past
  -- evidence that may be real provider money.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000017', 'refund',
    '9ef13000-0000-4000-8000-000000000017');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'corrupt link finalized past evidence, got %', v_status;
  END IF;
  -- A cash-only order with full manual coverage passes the claim
  -- guard on that coverage alone and runs the trusted finalization.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000019', 'refund',
    '9ef13000-0000-4000-8000-000000000019');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'cash-only coverage did not finalize, got %', v_status;
  END IF;
  -- A mixed order with an outstanding cash balance stays in the
  -- worker branch: finalizing now would close the order with money
  -- still owed.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000020', 'refund',
    '9ef13000-0000-4000-8000-000000000020');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'mixed cash balance finalized early, got %', v_status;
  END IF;
  -- A full manual declared as Paystack is a merchant claim about
  -- provider money, not coverage: the claim defers to the
  -- executor's API-verified provider check instead of finalizing.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000027', 'refund',
    '9ef13000-0000-4000-8000-000000000027');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'unverified paystack manual finalized, got %', v_status;
  END IF;
  -- The guard holds even when a verified provider row covers the
  -- same leg: the executor must still pair-or-quarantine the
  -- merchant claim, or a second provider refund escapes
  -- reconciliation.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000048', 'refund',
    '9ef13000-0000-4000-8000-000000000048');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'covered-leg manual claim finalized, got %', v_status;
  END IF;
  -- Anomalous terminal evidence blocks finalization like the
  -- manager's pending gate: the processed row covers the leg, but
  -- the linked Korapay row routes to the worker for quarantine
  -- instead of completing past unreconciled evidence.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000051', 'refund',
    '9ef13000-0000-4000-8000-000000000051');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'anomalous evidence finalized, got %', v_status;
  END IF;
  -- A self-terminalized foreign-currency leg is not validated
  -- money: the claim routes to the worker instead of finalizing.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000053', 'refund',
    '9ef13000-0000-4000-8000-000000000053');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'foreign-currency leg finalized, got %', v_status;
  END IF;
  -- The claim pins its orders-row lock explicitly: claim-vs-manual
  -- serialization must not rest on the incidental side-effect FK.
  IF pg_get_functiondef(
    'public.claim_order_cancellation_side_effect(uuid,text,uuid)'::regprocedure
  ) NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'claim lost its explicit orders lock';
  END IF;
  -- Provider confirmation converts the merchant claim into returned
  -- money: the label flips and the manager reports refunded. The
  -- status write fires the sync trigger (metadata-only updates do
  -- not), mirroring the 018 provider-confirmation pattern.
  UPDATE public.transactions
     SET status = 'completed',
         metadata = metadata || '{"provider_refund_status":"processed"}'::jsonb
   WHERE order_id = '9ef11000-0000-4000-8000-000000000027'
     AND transaction_type = 'refund';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000027';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'confirmed paystack manual did not flip label, got %',
      v_label;
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000027'
  ) INTO v_result;
  IF v_result->>'status' <> 'refunded' THEN
    RAISE EXCEPTION 'confirmed paystack manual status = %, want refunded',
      v_result->>'status';
  END IF;
  -- Per-leg claim assertions (028+) live in
  -- order_refund_management_per_leg_coverage.sql.
  -- The worker defers on the outstanding cash manual; mirror the
  -- deferral so the merchant's completion below re-arms the row.
  UPDATE public.order_cancellation_side_effects
     SET status = 'deferred', error = NULL
   WHERE order_id = '9ef11000-0000-4000-8000-000000000020'
     AND step = 'refund';
END;
$refund_claim_finalize$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_mixed_cash_manual$
DECLARE
  v_result jsonb;
BEGIN
  -- The merchant finishes the mixed order by recording the
  -- outstanding cash balance; the deferred row is preserved so the
  -- next drain reclaims it, and the response stays queued (not
  -- terminal refunded) until finalization runs.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000020', 'manual', 40,
    '2026-09-28T12:00:00Z', 'cash', 'cashrest-1',NULL,true
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'mixed cash remainder did not requeue, got %',
      v_result->>'status';
  END IF;
END;
$refund_mixed_cash_manual$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_mixed_cash_claim$
DECLARE
  v_won boolean;
  v_status text;
  v_label text;
BEGIN
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000020', 'refund',
    '9ef13000-0000-4000-8000-000000000021');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'mixed cash coverage did not finalize, got %', v_status;
  END IF;
  -- Provider confirmation flips an unverified row into returned
  -- money: the label follows on the status write.
  UPDATE public.transactions
     SET status = 'completed',
         metadata = metadata || '{"provider_refund_status":"processed"}'::jsonb
   WHERE id = '9ef12000-0000-4000-8000-000000000027';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000018';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'verified row did not flip payment label, got %', v_label;
  END IF;
END;
$refund_mixed_cash_claim$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_completed_row_requeue$
DECLARE
  v_result jsonb;
  v_row_status text;
BEGIN
  -- The final manual on a worker-completed row requeues it as failed
  -- so the drain reclaims it; a preserved completed status would
  -- strand settlement reversal, notifications, and review close.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000034', 'manual', 100,
    '2026-09-28T12:00:00Z', 'cash', 'cash34-1', NULL, true
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'final internal manual did not requeue, got %',
      v_result->>'status';
  END IF;
  SELECT status INTO v_row_status FROM public.order_cancellation_side_effects
  WHERE order_id = '9ef11000-0000-4000-8000-000000000034'
    AND step = 'refund';
  IF v_row_status <> 'failed' THEN
    RAISE EXCEPTION 'completed row not requeued, got %', v_row_status;
  END IF;
END;
$refund_completed_row_requeue$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_completed_row_claim$
DECLARE
  v_won boolean;
  v_status text;
BEGIN
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000034', 'refund',
    '9ef13000-0000-4000-8000-000000000036');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'requeued mixed order did not finalize, got %', v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.paystack_cancellation_refund_notifications
    WHERE order_id = '9ef11000-0000-4000-8000-000000000034') THEN
    RAISE EXCEPTION 'requeued finalization skipped notifications';
  END IF;
END;
$refund_completed_row_claim$;

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

RESET ROLE;

DO $refund_ledger_asserts$
DECLARE
  v_split_refs integer;
  v_split_merchant_refs integer;
  v_padded_ok boolean;
  v_internal_ok boolean;
  v_o4_status text;
BEGIN
  -- Each split allocation row carries a unique ledger identifier while
  -- the merchant reference stays queryable on every leg.
  SELECT count(DISTINCT gateway_reference) INTO v_split_refs
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000002'
    AND transaction_type = 'refund';
  IF v_split_refs <> 2 THEN
    RAISE EXCEPTION 'split ledger identifiers are not unique';
  END IF;
  SELECT count(*) INTO v_split_merchant_refs
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000002'
    AND transaction_type = 'refund'
    AND metadata->>'reference' = 'split-1';
  IF v_split_merchant_refs <> 2 THEN
    RAISE EXCEPTION 'merchant reference missing from a split leg';
  END IF;

  -- The overlong padded reference stored trimmed in both columns.
  SELECT metadata->>'reference' = pg_catalog.repeat('p', 100)
    AND gateway_reference = pg_catalog.repeat('p', 100) || '#1'
    INTO v_padded_ok
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000003'
    AND transaction_type = 'refund' AND gateway = 'manual';
  IF v_padded_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'padded reference not stored trimmed';
  END IF;

  -- The split-internal manual row links the Paystack leg only.
  SELECT metadata->>'payment_transaction_id'
      = '9ef12000-0000-4000-8000-000000000010'
    INTO v_internal_ok
  FROM public.transactions
  WHERE order_id = '9ef11000-0000-4000-8000-000000000006'
    AND transaction_type = 'refund' AND gateway = 'manual';
  IF v_internal_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'split-internal manual misallocated';
  END IF;

  SELECT payment_status INTO v_o4_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000004';
  IF v_o4_status <> 'refunded' THEN
    RAISE EXCEPTION 'reversal-adjusted completion did not flip payment status';
  END IF;

  -- The aggregate claim completed the fully manual order; the
  -- self-terminal PayPal leg flipped its label on landing.
  IF NOT EXISTS (SELECT 1 FROM public.order_cancellation_side_effects
    WHERE order_id = '9ef11000-0000-4000-8000-000000000002'
      AND step = 'refund' AND status = 'completed') THEN
    RAISE EXCEPTION 'claim did not complete the fully manual order';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.paystack_cancellation_refund_notifications
    WHERE order_id = '9ef11000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'finalization skipped notifications';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.paystack_cancellation_refund_notifications
    WHERE order_id = '9ef11000-0000-4000-8000-000000000019') THEN
    RAISE EXCEPTION 'cash-only finalization skipped notifications';
  END IF;
  SELECT payment_status INTO v_o4_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000013';
  IF v_o4_status <> 'refunded' THEN
    RAISE EXCEPTION 'self-terminal payment leg did not flip payment status';
  END IF;

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
$refund_ledger_asserts$;

ROLLBACK;
