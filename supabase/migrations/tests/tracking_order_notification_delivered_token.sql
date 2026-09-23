-- =============================================
-- REGRESSION TEST (1/3): token lookup projects terminal delivery.
--
-- get_order_tracking must project notification_delivered=true once the
-- immediate-order after() records terminal success (claim status
-- 'sent'), driven here through the production claim/complete RPCs.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/tracking_order_notification_delivered_token.sql
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

  PERFORM public.claim_immediate_order_notification(v_delivered_order_id);
  PERFORM public.complete_immediate_order_notification(
    v_delivered_order_id,
    true
  );

  SELECT notification_delivered INTO v_delivered
  FROM public.get_order_tracking(
    'tracking-delivered-regression', NULL, NULL, NULL, 'delivered-token-001'
  );
  ASSERT v_delivered = true, 'sent claim must project notification_delivered';
END;
$$;

ROLLBACK;
