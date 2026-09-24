-- =============================================
-- REGRESSION TEST (1/3): token lookup projects terminal delivery.
--
-- get_order_tracking must project notification_delivered=true once the
-- immediate-order after() records terminal success (claim status
-- 'sent'), driven here through the production claim/complete RPCs.
--
-- Probes isolate the layer before calling: P0002 the function itself
-- is absent, P0003 the projection is absent from its result signature,
-- P0004 a body column is absent from its table.
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
  v_proc_count integer;
  v_sig_count integer;
BEGIN
  SELECT count(*) INTO v_proc_count
  FROM pg_proc
  WHERE proname = 'get_order_tracking'
    AND pronamespace = 'public'::regnamespace;
  IF v_proc_count = 0 THEN
    RAISE EXCEPTION 'get_order_tracking absent' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_sig_count
  FROM pg_proc p
  WHERE p.proname = 'get_order_tracking'
    AND p.pronamespace = 'public'::regnamespace
    AND position(
      'notification_delivered' in pg_get_function_result(p.oid)
    ) > 0;
  IF v_sig_count = 0 THEN
    RAISE EXCEPTION 'notification_delivered projection absent'
      USING ERRCODE = 'P0003';
  END IF;
END;
$$;

-- One presence probe per get_order_tracking body column. Each DO
-- is its own statement so the replay harness line number names the column.
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'amount_paid'), 'orders.amount_paid absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'cancelled_at'), 'orders.cancelled_at absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'currency'), 'orders.currency absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'customer_email'), 'orders.customer_email absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'customer_name'), 'orders.customer_name absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'customer_phone'), 'orders.customer_phone absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'delivered_at'), 'orders.delivered_at absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'discount_amount'), 'orders.discount_amount absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'external_source'), 'orders.external_source absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'gift_wrapping_fee'), 'orders.gift_wrapping_fee absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'id'), 'orders.id absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'import_job_id'), 'orders.import_job_id absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'merchant_id'), 'orders.merchant_id absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'order_number'), 'orders.order_number absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'paid_at'), 'orders.paid_at absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'payment_method'), 'orders.payment_method absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'payment_status'), 'orders.payment_status absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'shipped_at'), 'orders.shipped_at absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'shipping_address'), 'orders.shipping_address absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'shipping_fee'), 'orders.shipping_fee absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'shipping_provider'), 'orders.shipping_provider absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'shipping_status'), 'orders.shipping_status absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'subtotal'), 'orders.subtotal absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'tax_amount'), 'orders.tax_amount absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'total'), 'orders.total absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'tracking_number'), 'orders.tracking_number absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'tracking_token'), 'orders.tracking_token absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'business_name'), 'merchants.business_name absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'id'), 'merchants.id absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'logo_url'), 'merchants.logo_url absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'phone'), 'merchants.phone absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'slug'), 'merchants.slug absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'support_email'), 'merchants.support_email absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'support_phone'), 'merchants.support_phone absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'condition'), 'order_items.condition absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'id'), 'order_items.id absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'image_url'), 'order_items.image_url absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'line_id'), 'order_items.line_id absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'name'), 'order_items.name absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'order_id'), 'order_items.order_id absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'price'), 'order_items.price absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'product_id'), 'order_items.product_id absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'quantity'), 'order_items.quantity absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'variant_name'), 'order_items.variant_name absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'id'), 'products.id absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'images'), 'products.images absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_payment_accounts' AND column_name = 'account_name'), 'order_payment_accounts.account_name absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_payment_accounts' AND column_name = 'account_number'), 'order_payment_accounts.account_number absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_payment_accounts' AND column_name = 'assigned_at'), 'order_payment_accounts.assigned_at absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_payment_accounts' AND column_name = 'assignment_customer_email_source'), 'order_payment_accounts.assignment_customer_email_source absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_payment_accounts' AND column_name = 'bank_name'), 'order_payment_accounts.bank_name absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_payment_accounts' AND column_name = 'created_at'), 'order_payment_accounts.created_at absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_payment_accounts' AND column_name = 'expires_at'), 'order_payment_accounts.expires_at absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_payment_accounts' AND column_name = 'order_id'), 'order_payment_accounts.order_id absent'; END $probe$;
DO $probe$ BEGIN ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_payment_accounts' AND column_name = 'provider'), 'order_payment_accounts.provider absent'; END $probe$;

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
  IF v_delivered IS NULL THEN
    RAISE EXCEPTION 'token lookup returned no row'
      USING ERRCODE = 'P0005';
  END IF;
  IF v_delivered = false THEN
    RAISE EXCEPTION 'sent claim not projected as delivered'
      USING ERRCODE = 'P0006';
  END IF;
END;
$$;

ROLLBACK;
