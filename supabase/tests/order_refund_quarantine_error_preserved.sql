-- REGRESSION TEST: manual records preserve quarantine errors.
--
-- The record helper's finalization upsert preserves a
-- delivery_uncertain step (ops review still open) but used to wipe
-- its error, so the manager reported requires_review with no cause.
-- The upsert now clears error only on the completed-to-failed
-- requeue. Fixtures use the 9ef9 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_quarantine_error_preserved.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $quarantine_fixtures$
DECLARE
  v_owner_id uuid := '9ef90000-0000-4000-8000-000000000001';
  v_merchant_id uuid := '9ef90100-0000-4000-8000-000000000001';
  v_order_id uuid := '9ef91000-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'quar@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'quar@example.test',
      'Quarantine Fixture', 'quarantine-fixture');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    (v_order_id, v_merchant_id, 'QUAR-001', 100, 100,
      'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef92000-0000-4000-8000-000000000001', v_merchant_id, v_order_id,
      'payment', 100, 'NGN', 'completed', 'cash', 'quar-leg',
      '{}'::jsonb);

  -- A quarantined step with its recorded review reason.
  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    (v_order_id, v_merchant_id, 'refund', 'delivery_uncertain',
      gen_random_uuid(), 2, 'Quarantine: ledger gap under ops review');

END;
$quarantine_fixtures$;

-- The manager gates manual records behind open quarantine steps,
-- so the upsert's preserved-status branch is reachable only when
-- the step flips mid-flight (or via future callers): exercise the
-- helper directly as the service role, the way DEFINER-side calls
-- reach it, with the owner as the JWT actor.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef90000-0000-4000-8000-000000000001',
  true
);

DO $quarantine_assert$
DECLARE
  v_result jsonb;
  v_error text;
  v_status text;
BEGIN
  SELECT private.record_manual_order_refund(
    '9ef91000-0000-4000-8000-000000000001',
    '9ef90100-0000-4000-8000-000000000001',
    'NGN', pg_catalog.now(), '9ef90000-0000-4000-8000-000000000001',
    100, pg_catalog.now(), 'bank_transfer', NULL, true, 'quar-rec-1',
    100, 0, 'delivery_uncertain', 'Quarantine: ledger gap under ops review',
    2, 0, NULL
  ) INTO v_result;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'record beside quarantine returned null';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.transactions
      WHERE order_id = '9ef91000-0000-4000-8000-000000000001'
        AND metadata->>'reference' = 'quar-rec-1') THEN
    RAISE EXCEPTION 'quarantined record never wrote its ledger row';
  END IF;
  SELECT error, status INTO v_error, v_status
    FROM public.order_cancellation_side_effects
    WHERE order_id = '9ef91000-0000-4000-8000-000000000001'
      AND step = 'refund';
  IF v_status <> 'delivery_uncertain' THEN
    RAISE EXCEPTION 'quarantine status moved to %', v_status;
  END IF;
  IF v_error IS NULL OR v_error NOT LIKE 'Quarantine:%' THEN
    RAISE EXCEPTION 'quarantine error erased: %', v_error;
  END IF;
  IF (v_result->>'stepError') IS NULL
    OR (v_result->>'stepError') NOT LIKE 'Quarantine:%' THEN
    RAISE EXCEPTION 'returned step error lost the cause: %', v_result;
  END IF;
END;
$quarantine_assert$;

-- The owner-visible status still reports review for the open
-- quarantine (status reads skip the manager processing gate).
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef90000-0000-4000-8000-000000000001',
  true
);

DO $quarantine_status$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.manage_order_refund(
    '9ef91000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF v_result->>'status' <> 'requires_review' THEN
    RAISE EXCEPTION 'quarantine reported %', v_result->>'status';
  END IF;
END;
$quarantine_status$;

ROLLBACK;
