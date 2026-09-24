-- =============================================
-- REGRESSION TEST: authenticated delivery-flag lookup
--   The signed-in branch of GET /api/storefront/orders/[id] selects the
--   orders table directly, where no notification_delivered column exists
--   — so without this lookup, signed-in shoppers polling the
--   order-success page always observe the flag as false and never record
--   invoice_generated. get_order_notification_delivered() exposes only
--   the EXISTS(sent-claim) bit for orders the caller may already read
--   (ownership mirroring orders_select_policy). Every denial reads as
--   not delivered.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/order_notification_delivered_lookup.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

-- customers.user_id references auth.users: seed the owner rows as the
-- session superuser (service_role cannot write the auth schema).
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('9f000000-0000-4000-8000-000000000259', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'delivered-lookup-owner@example.com', 'test', now(), now(), now(), '{}', '{}'),
  ('9f000000-0000-4000-8000-000000000258', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'delivered-lookup-other@example.com', 'test', now(), now(), now(), '{}', '{}');

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '9f000000-0000-4000-8000-000000000251';
  v_mine_customer_id uuid := '9f000000-0000-4000-8000-000000000252';
  v_theirs_customer_id uuid := '9f000000-0000-4000-8000-000000000253';
  v_mine_order_id uuid := '9f000000-0000-4000-8000-000000000254';
  v_theirs_order_id uuid := '9f000000-0000-4000-8000-000000000255';
  v_token uuid;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    'delivered-lookup-regression@example.com',
    'Delivered Lookup Regression',
    'delivered-lookup-regression'
  );
  INSERT INTO public.customers (id, user_id)
  VALUES
    (v_mine_customer_id, '9f000000-0000-4000-8000-000000000259'),
    (v_theirs_customer_id, '9f000000-0000-4000-8000-000000000258');
  INSERT INTO public.orders (id, merchant_id, order_number, total, customer_id)
  VALUES
    (v_mine_order_id, v_merchant_id, 'DELIVERED-LOOKUP-001', 1000, v_mine_customer_id),
    (v_theirs_order_id, v_merchant_id, 'DELIVERED-LOOKUP-002', 1000, v_theirs_customer_id);

  -- Both orders reach terminal sent; only the caller's own row may
  -- report it.
  SELECT claim_token INTO v_token
  FROM public.claim_immediate_order_notification(v_mine_order_id);
  PERFORM public.complete_immediate_order_notification(
    v_mine_order_id, true, v_token
  );
  SELECT claim_token INTO v_token
  FROM public.claim_immediate_order_notification(v_theirs_order_id);
  PERFORM public.complete_immediate_order_notification(
    v_theirs_order_id, true, v_token
  );
END;
$$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000259', true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated', 'sub', '9f000000-0000-4000-8000-000000000259'
  )::text,
  true
);

DO $$
DECLARE
  v_delivered boolean;
BEGIN
  -- Own delivered order reports delivered.
  SELECT public.get_order_notification_delivered(
    '9f000000-0000-4000-8000-000000000254'
  )
  INTO v_delivered;
  ASSERT v_delivered IS TRUE, 'own sent order must read delivered';

  -- Someone else's delivered order reads as not delivered.
  SELECT public.get_order_notification_delivered(
    '9f000000-0000-4000-8000-000000000255'
  )
  INTO v_delivered;
  ASSERT v_delivered IS FALSE, 'foreign order must read not delivered';

  -- Unknown orders read as not delivered (no oracle).
  SELECT public.get_order_notification_delivered(
    '9f000000-0000-4000-8000-000000000257'
  )
  INTO v_delivered;
  ASSERT v_delivered IS FALSE, 'unknown order must read not delivered';

  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_order_notification_delivered(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must execute get_order_notification_delivered(uuid)';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.get_order_notification_delivered(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute get_order_notification_delivered(uuid)';
  END IF;
END;
$$;

ROLLBACK;
