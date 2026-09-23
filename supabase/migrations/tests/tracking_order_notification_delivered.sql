-- =============================================
-- REGRESSION TEST: tracking projection carries the terminal
-- immediate-notification delivery flag.
--
-- Success screens must emit invoice_generated only after the server
-- actually created the invoice artifacts. The immediate-order after()
-- records terminal success on immediate_order_notification_claims
-- (status 'sent'); get_order_tracking must project that as
-- notification_delivered so the web and mobile success lookups can gate
-- the funnel event on it instead of claiming it at order creation.
--
-- Claim state is driven through the production RPC path (claim +
-- complete), exactly as the after() callback does it.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/tracking_order_notification_delivered.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '9f000000-0000-4000-8000-000000000211';
  v_delivered_order_id uuid := '9f000000-0000-4000-8000-000000000212';
  v_pending_order_id uuid := '9f000000-0000-4000-8000-000000000213';
  v_delivered boolean;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    'tracking-delivered-regression@example.com',
    'Tracking Delivered Regression',
    'tracking-delivered-regression'
  );
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, customer_email, tracking_token
  )
  VALUES (
    v_delivered_order_id,
    v_merchant_id,
    'TRACKING-DELIVERED-001',
    1000,
    'delivered@example.com',
    'delivered-token-001'
  );
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, customer_email, tracking_token
  )
  VALUES (
    v_pending_order_id,
    v_merchant_id,
    'TRACKING-DELIVERED-002',
    2000,
    'pending@example.com',
    'pending-token-002'
  );

  -- Terminal after() success marks the claim sent, through the same RPCs
  -- the route uses.
  PERFORM public.claim_immediate_order_notification(v_delivered_order_id);
  PERFORM public.complete_immediate_order_notification(
    v_delivered_order_id,
    true
  );
  -- A failed (releasable) delivery is not delivery.
  PERFORM public.claim_immediate_order_notification(v_pending_order_id);
  PERFORM public.complete_immediate_order_notification(
    v_pending_order_id,
    false
  );

  -- Token lookup projects delivered for the sent order.
  SELECT notification_delivered INTO v_delivered
  FROM public.get_order_tracking(
    'tracking-delivered-regression', NULL, NULL, NULL, 'delivered-token-001'
  );
  ASSERT v_delivered = true, 'sent claim must project notification_delivered';

  -- Token lookup projects not-delivered for the failed order.
  SELECT notification_delivered INTO v_delivered
  FROM public.get_order_tracking(
    'tracking-delivered-regression', NULL, NULL, NULL, 'pending-token-002'
  );
  ASSERT v_delivered = false, 'failed claim must not project delivered';

  -- Email lookup agrees with the token lookup.
  SELECT notification_delivered INTO v_delivered
  FROM public.get_order_tracking(
    'tracking-delivered-regression',
    v_delivered_order_id,
    NULL,
    'delivered@example.com',
    NULL
  );
  ASSERT v_delivered = true, 'email lookup must project delivered';

  -- The tracking RPC stays publicly executable (guest success lookups).
  IF NOT pg_catalog.has_function_privilege(
    'anon',
    'public.get_order_tracking(text,uuid,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must execute get_order_tracking(text,uuid,text,text,text)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_order_tracking(text,uuid,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must execute get_order_tracking(text,uuid,text,text,text)';
  END IF;
END;
$$;

ROLLBACK;
