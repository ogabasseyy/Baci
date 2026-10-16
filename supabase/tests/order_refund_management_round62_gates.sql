-- REGRESSION TEST: round-24 sweep-reselect and RPC-record claim gates.
--
-- A stamped manual dropped out of the contradiction sweep once a
-- verdict replaced its `processed` stamp: the sweep, the transition,
-- and the webhook lookup all keyed on the last verdict instead of
-- the stored provider id, so a later provider recovery was never
-- observed. Stamped manuals now reselect by numeric stored provider
-- id whatever the last verdict was. Separately, the claim/manual
-- concurrency runner's Phase 2 (RPC-recorded manual, then claim)
-- runs minimally in CI, so the manual → claim → completed coupling
-- is pinned here: only an end-to-end record proves the manager's
-- writes are what the claim's finalization reads. Self-contained
-- fixtures use the c621 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round62_gates.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := 'c6210000-0000-4000-8000-000000000001';
  v_manager_id uuid := 'c6210000-0000-4000-8000-000000000002';
  v_merchant_id uuid := 'c6210100-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'gate62-owner@example.test',
      'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb),
    (v_manager_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'gate62-manager@example.test',
      'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb);

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    'c6210000-0000-4000-8000-000000000099',
    '00000000-0000-4000-8000-000000000000',
    'authenticated', 'authenticated', 'gate62-alien@example.test',
    'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
    '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'gate62-owner@example.test',
      'Gate62 Fixture', 'gate62-fixture'),
    ('c6210100-0000-4000-8000-000000000099',
      'c6210000-0000-4000-8000-000000000099',
      'gate62-alien@example.test', 'Gate62 Alien', 'gate62-alien');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_manager_id, 'gate62-manager@example.test',
      'Gate62 Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    -- Post-contradiction finalized order: the stamped manual below
    -- carries a needs-attention verdict, not a processed stamp.
    ('c6211000-0000-4000-8000-000000000001', v_merchant_id, 'GATE62-001',
      100, 100, 'refunded', 'cancelled', pg_catalog.now()),
    -- Fresh paid order for the RPC-record → claim coupling.
    ('c6211000-0000-4000-8000-000000000002', v_merchant_id, 'GATE62-002',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    -- Finalized control: an unstamped manual never reselects.
    ('c6211000-0000-4000-8000-000000000003', v_merchant_id, 'GATE62-003',
      100, 100, 'refunded', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('c6212000-0000-4000-8000-000000000001', v_merchant_id,
      'c6211000-0000-4000-8000-000000000001', 'payment', 100, 'NGN',
      'completed', 'paystack', 'gate62-pay-1', '{}'::jsonb),
    ('c6212000-0000-4000-8000-000000000002', v_merchant_id,
      'c6211000-0000-4000-8000-000000000001', 'refund', 100, 'NGN',
      'completed', 'manual', 'merchant-62-1',
      jsonb_build_object(
        'method', 'paystack',
        'payment_transaction_id', 'c6212000-0000-4000-8000-000000000001',
        'provider_refund_id', 77,
        'provider_refund_status', 'needs-attention',
        'reference', 'merchant-62-1',
        'confirmed', 'true')),
    ('c6212000-0000-4000-8000-000000000003', v_merchant_id,
      'c6211000-0000-4000-8000-000000000002', 'payment', 100, 'NGN',
      'completed', 'paystack', 'gate62-pay-2', '{}'::jsonb),
    ('c6212000-0000-4000-8000-000000000004', v_merchant_id,
      'c6211000-0000-4000-8000-000000000003', 'refund', 100, 'NGN',
      'completed', 'manual', 'plain-62-3',
      jsonb_build_object(
        'method', 'bank_transfer',
        'reference', 'plain-62-3',
        'confirmed', 'true'));

  -- Sweep rows must predate the finalized cutoff.
  UPDATE public.transactions SET updated_at = pg_catalog.now() - interval '1 hour'
  WHERE id IN (
      'c6212000-0000-4000-8000-000000000002',
      'c6212000-0000-4000-8000-000000000004');
END;
$fixtures$;

DO $round62_gates$
DECLARE
  v_won boolean;
  v_status text;
  v_verdict text;
BEGIN
  -- A contradiction verdict must not hide a stamped manual from the
  -- sweep: the needs-attention row reselects by stored provider id.
  IF NOT EXISTS (
    SELECT 1
    FROM public.select_completed_paystack_cancellation_refund_candidates_v1(
      25, pg_catalog.now(), 5)
    WHERE id = 'c6212000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'needs-attention stamped manual missing from sweep';
  END IF;
  -- An unstamped manual carries no provider id: nothing can ever
  -- recheck it, so it stays out.
  IF EXISTS (
    SELECT 1
    FROM public.select_completed_paystack_cancellation_refund_candidates_v1(
      25, pg_catalog.now(), 5)
    WHERE id = 'c6212000-0000-4000-8000-000000000004'
  ) THEN
    RAISE EXCEPTION 'unstamped manual reached the provider sweep';
  END IF;

  -- Simulate the failure-resolver reopen, then land the provider
  -- recovery: the transition accepts the processed verdict on the
  -- needs-attention stamped row instead of dying at refund_not_found.
  UPDATE public.orders SET payment_status = 'paid'
  WHERE id = 'c6211000-0000-4000-8000-000000000001';
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    'c6212000-0000-4000-8000-000000000002', 'processed', 999,
    10000, 'NGN') INTO v_verdict;
  IF v_verdict <> 'processed' THEN
    RAISE EXCEPTION 'recovery verdict returned %, want processed', v_verdict;
  END IF;
  SELECT metadata->>'provider_refund_status' INTO v_status
  FROM public.transactions
  WHERE id = 'c6212000-0000-4000-8000-000000000002';
  IF v_status <> 'processed' THEN
    RAISE EXCEPTION 'recovery did not restore the processed stamp, got %',
      v_status;
  END IF;

  -- Record a full manual through the RPC (attested, as the manager
  -- would), then the claim must see that coverage and finalize —
  -- never take the worker branch under recorded money.
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role', 'authenticated', true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', 'c6210000-0000-4000-8000-000000000002', true);
  SET ROLE authenticated;
  -- A refund date before the order existed is an entry error, not a
  -- transfer: the window floor rejects it like a future date.
  BEGIN
    PERFORM public.manage_order_refund(
      'c6211000-0000-4000-8000-000000000002', 'manual', 100,
      pg_catalog.now() - interval '1 day', 'bank_transfer', 'floor-62-1',
      NULL, true);
    RAISE EXCEPTION 'pre-order refund date was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid_manual_refund' THEN RAISE; END IF;
  END;
  PERFORM public.manage_order_refund(
    'c6211000-0000-4000-8000-000000000002', 'manual', 100,
    pg_catalog.now(), 'bank_transfer', 'rpc-62-1', NULL, true);
  RESET ROLE;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role', 'service_role', true);
  SET ROLE service_role;
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    'c6211000-0000-4000-8000-000000000002', 'refund',
    'c6213000-0000-4000-8000-000000000002');
  IF v_won OR v_status <> 'completed' THEN
    RAISE EXCEPTION 'post-manual claim won=% status=%, want won=f completed',
      v_won, v_status;
  END IF;
END;
$round62_gates$;

DO $round62_replay_scope$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_branch text;
BEGIN
  -- Replay scoping: the lookup keys merchant and terminal status
  -- like the manager, so corrupt or foreign rows never read as a
  -- recorded transfer of this merchant's order.
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('c6212000-0000-4000-8000-000000000011',
      'c6210100-0000-4000-8000-000000000099',
      'c6211000-0000-4000-8000-000000000002', 'refund', 100, 'NGN',
      'completed', 'manual', 'alien-62-1',
      jsonb_build_object(
        'method', 'bank_transfer', 'reference', 'alien-62-1',
        'refunded_at', v_now, 'confirmed', 'true')),
    ('c6212000-0000-4000-8000-000000000012',
      'c6210100-0000-4000-8000-000000000001',
      'c6211000-0000-4000-8000-000000000002', 'refund', 100, 'NGN',
      'failed', 'manual', 'failed-own-62-1',
      jsonb_build_object(
        'method', 'bank_transfer', 'reference', 'failed-own-62-1',
        'refunded_at', v_now, 'confirmed', 'true')),
    ('c6212000-0000-4000-8000-000000000013',
      'c6210100-0000-4000-8000-000000000001',
      'c6211000-0000-4000-8000-000000000002', 'refund', 100, 'NGN',
      'completed', 'manual', 'own-62-1',
      jsonb_build_object(
        'method', 'bank_transfer', 'reference', 'own-62-1',
        'refunded_at', v_now, 'confirmed', 'true'));
  -- An alien-merchant row is not this merchant's transfer: no false
  -- replay, no false conflict — the record path runs fresh.
  SELECT private.apply_manual_refund_replay_v1(
    'c6211000-0000-4000-8000-000000000002', 100, v_now,
    'bank_transfer', 'alien-62-1', NULL,
    'c6210100-0000-4000-8000-000000000001', false) INTO v_branch;
  IF v_branch <> 'manual' THEN
    RAISE EXCEPTION 'alien row replayed as %, want manual', v_branch;
  END IF;
  -- A failed row is not a recorded transfer either: retrying one
  -- records fresh instead of conflicting with its own past attempt.
  SELECT private.apply_manual_refund_replay_v1(
    'c6211000-0000-4000-8000-000000000002', 100, v_now,
    'bank_transfer', 'failed-own-62-1', NULL,
    'c6210100-0000-4000-8000-000000000001', false) INTO v_branch;
  IF v_branch <> 'manual' THEN
    RAISE EXCEPTION 'failed row replayed as %, want manual', v_branch;
  END IF;
  -- Positive control: the own-merchant completed row still replays.
  SELECT private.apply_manual_refund_replay_v1(
    'c6211000-0000-4000-8000-000000000002', 100, v_now,
    'bank_transfer', 'own-62-1', NULL,
    'c6210100-0000-4000-8000-000000000001', false) INTO v_branch;
  IF v_branch <> 'status' THEN
    RAISE EXCEPTION 'own row replayed as %, want status', v_branch;
  END IF;
END;
$round62_replay_scope$;

ROLLBACK;
