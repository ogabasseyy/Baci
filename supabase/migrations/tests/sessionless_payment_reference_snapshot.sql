-- =============================================
-- REGRESSION TEST: sessionless (Bearer-owned) payment snapshot
--   POST /api/payments/verify serves mobile Bearer [REDACTED] without
--   ever touching the service-role client: the bearer-owned snapshot RPC
--   binds the reference to the caller's own order
--   (reference→order→customer.user_id = auth.uid()) and returns the
--   minimal verification read model, including the read-only inventory
--   proof. Every denial returns zero rows (no existence oracle).
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/sessionless_payment_reference_snapshot.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

-- customers.user_id references auth.users: seed the owner rows as the
-- session superuser (service_role cannot write the auth schema).
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('9f000000-0000-4000-8000-000000000649', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'sessionless-snapshot-owner@example.com', 'test', now(), now(), now(), '{}', '{}'),
  ('9f000000-0000-4000-8000-000000000648', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'sessionless-snapshot-other@example.com', 'test', now(), now(), now(), '{}', '{}');

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '9f000000-0000-4000-8000-000000000601';
  v_mine_customer_id uuid := '9f000000-0000-4000-8000-000000000602';
  v_theirs_customer_id uuid := '9f000000-0000-4000-8000-000000000603';
  v_mine_order_id uuid := '9f000000-0000-4000-8000-000000000604';
  v_theirs_order_id uuid := '9f000000-0000-4000-8000-000000000605';
  v_product_id uuid := '9f000000-0000-4000-8000-000000000606';
  v_anchor_id uuid := '9f000000-0000-4000-8000-000000000607';
  v_item_id uuid := '9f000000-0000-4000-8000-000000000608';
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    'sessionless-snapshot-regression@example.com',
    'Sessionless Snapshot Regression',
    'sessionless-snapshot-regression'
  );
  INSERT INTO public.customers (id, user_id)
  VALUES
    (v_mine_customer_id, '9f000000-0000-4000-8000-000000000649'),
    (v_theirs_customer_id, '9f000000-0000-4000-8000-000000000648');
  -- One serialized_strict product with a durably-held unit on the
  -- caller's order, so the snapshot carries inventory_confirmed=true.
  INSERT INTO public.products (id, merchant_id, name, price, status, inventory_tracking_policy)
  VALUES (v_product_id, v_merchant_id, 'Snapshot Phone', 180000, 'active', 'serialized_strict');
  INSERT INTO public.product_variants (
    id, product_id, merchant_id, attributes, price_override,
    inventory_tracking_policy, is_inventory_anchor
  )
  VALUES (v_anchor_id, v_product_id, v_merchant_id, '{"is_anchor": true}'::jsonb, 0, 'inherit', true);
  UPDATE public.products SET has_variants = false, inventory_anchor_variant_id = v_anchor_id WHERE id = v_product_id;
  INSERT INTO public.orders (id, merchant_id, order_number, total, customer_id, payment_status)
  VALUES
    (v_mine_order_id, v_merchant_id, 'SESSIONLESS-SNAPSHOT-001', 180000, v_mine_customer_id, 'paid'),
    (v_theirs_order_id, v_merchant_id, 'SESSIONLESS-SNAPSHOT-002', 180000, v_theirs_customer_id, 'paid');
  INSERT INTO public.order_items (
    id, order_id, product_id, variant_id, name, price, quantity, product_match_status
  )
  VALUES (v_item_id, v_mine_order_id, v_product_id, NULL, 'Snapshot Phone', 180000, 1, 'unreviewed');
  INSERT INTO public.transactions (
    id, merchant_id, transaction_type, amount, currency, status, order_id,
    gateway_reference
  )
  VALUES
    (
      '9f000000-0000-4000-8000-000000000646', v_merchant_id, 'payment',
      180000, 'NGN', 'completed', v_mine_order_id, 'SESSIONLESS-SNAPSHOT-MINE'
    ),
    (
      '9f000000-0000-4000-8000-000000000647', v_merchant_id, 'payment',
      180000, 'NGN', 'completed', v_theirs_order_id, 'SESSIONLESS-SNAPSHOT-THEIRS'
    );
  INSERT INTO public.variant_inventory (
    id, variant_id, merchant_id, identifier_type, identifier_value,
    status, order_id, order_item_id,
    reserved_at, first_reserved_at, reservation_expires_at
  )
  VALUES (
    '9f000000-0000-4000-8000-000000000650', v_anchor_id, v_merchant_id, 'imei', '966666666666666',
    'reserved', v_mine_order_id, v_item_id,
    now(), now(), NULL
  );
END;
$$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000649', true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated', 'sub', '9f000000-0000-4000-8000-000000000649'
  )::text,
  true
);

DO $$
DECLARE
  v_row record;
BEGIN
  -- Own reference returns the verification row with the inventory proof.
  SELECT * INTO v_row
  FROM public.get_sessionless_payment_reference_snapshot('SESSIONLESS-SNAPSHOT-MINE');
  ASSERT v_row.order_id = '9f000000-0000-4000-8000-000000000604',
    'own reference must return its order';
  ASSERT v_row.inventory_confirmed IS TRUE,
    'durably-held strict units must prove inventory';
  ASSERT v_row.order_payment_status = 'paid', 'snapshot must carry status';

  -- Someone else's valid reference returns zero rows (no oracle).
  PERFORM * FROM public.get_sessionless_payment_reference_snapshot('SESSIONLESS-SNAPSHOT-THEIRS')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'foreign reference must return zero rows';
  END IF;

  -- A bogus reference returns zero rows identically.
  PERFORM * FROM public.get_sessionless_payment_reference_snapshot('SESSIONLESS-SNAPSHOT-BOGUS')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'bogus reference must return zero rows';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_sessionless_payment_reference_snapshot(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must execute get_sessionless_payment_reference_snapshot(text)';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.get_sessionless_payment_reference_snapshot(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute get_sessionless_payment_reference_snapshot(text)';
  END IF;
END;
$$;

ROLLBACK;
