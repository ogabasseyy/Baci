-- =============================================
-- REGRESSION TEST (2/3): non-delivered states project false.
--
-- A failed (releasable) claim is not delivery: the token lookup must
-- project notification_delivered=false so success screens keep their
-- bounded refresh lane instead of booking a conversion. The email
-- lookup on a delivered order must agree with the token lookup.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/tracking_order_notification_pending.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '9f000000-0000-4000-8000-000000000221';
  v_delivered_order_id uuid := '9f000000-0000-4000-8000-000000000222';
  v_pending_order_id uuid := '9f000000-0000-4000-8000-000000000223';
  v_delivered boolean;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    'tracking-pending-regression@example.com',
    'Tracking Pending Regression',
    'tracking-pending-regression'
  );
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, customer_email, tracking_token
  )
  VALUES (
    v_delivered_order_id,
    v_merchant_id,
    'TRACKING-PENDING-001',
    1000,
    'delivered2@example.com',
    'delivered-token-002'
  );
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, customer_email, tracking_token
  )
  VALUES (
    v_pending_order_id,
    v_merchant_id,
    'TRACKING-PENDING-002',
    2000,
    'pending2@example.com',
    'pending-token-002'
  );

  PERFORM public.claim_immediate_order_notification(v_delivered_order_id);
  PERFORM public.complete_immediate_order_notification(
    v_delivered_order_id,
    true
  );
  PERFORM public.claim_immediate_order_notification(v_pending_order_id);
  PERFORM public.complete_immediate_order_notification(
    v_pending_order_id,
    false
  );

  SELECT notification_delivered INTO v_delivered
  FROM public.get_order_tracking(
    'tracking-pending-regression', NULL, NULL, NULL, 'pending-token-002'
  );
  ASSERT v_delivered = false, 'failed claim must not project delivered';

  SELECT notification_delivered INTO v_delivered
  FROM public.get_order_tracking(
    'tracking-pending-regression',
    v_delivered_order_id,
    NULL,
    'delivered2@example.com',
    NULL
  );
  ASSERT v_delivered = true, 'email lookup must project delivered';
END;
$$;

ROLLBACK;
