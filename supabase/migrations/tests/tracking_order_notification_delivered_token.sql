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
  v_merchant_id uuid := '9f000000-0000-4000-8000-000000000211';
  v_delivered_order_id uuid := '9f000000-0000-4000-8000-000000000212';
  v_proc_count integer;
  v_sig_count integer;
  v_col text;
  v_col_count integer;
  v_delivered boolean;
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

  FOR v_col IN
    SELECT unnest(ARRAY[
      'orders.amount_paid', 'orders.cancelled_at', 'orders.currency',
      'orders.customer_email', 'orders.customer_name', 'orders.customer_phone',
      'orders.delivered_at', 'orders.discount_amount', 'orders.external_source',
      'orders.gift_wrapping_fee', 'orders.id', 'orders.import_job_id',
      'orders.merchant_id', 'orders.order_number', 'orders.paid_at',
      'orders.payment_method', 'orders.payment_status', 'orders.shipped_at',
      'orders.shipping_address', 'orders.shipping_fee', 'orders.shipping_provider',
      'orders.shipping_status', 'orders.subtotal', 'orders.tax_amount',
      'orders.total', 'orders.tracking_number', 'orders.tracking_token',
      'merchants.business_name', 'merchants.id', 'merchants.logo_url',
      'merchants.phone', 'merchants.slug', 'merchants.support_email',
      'merchants.support_phone', 'order_items.condition', 'order_items.id',
      'order_items.image_url', 'order_items.line_id', 'order_items.name',
      'order_items.order_id', 'order_items.price', 'order_items.product_id',
      'order_items.quantity', 'order_items.variant_name', 'products.id',
      'products.images', 'order_payment_accounts.account_name',
      'order_payment_accounts.account_number',
      'order_payment_accounts.assigned_at',
      'order_payment_accounts.assignment_customer_email_source',
      'order_payment_accounts.bank_name', 'order_payment_accounts.created_at',
      'order_payment_accounts.expires_at', 'order_payment_accounts.order_id',
      'order_payment_accounts.provider'
    ])
  LOOP
    SELECT count(*) INTO v_col_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = split_part(v_col, '.', 1)
      AND column_name = split_part(v_col, '.', 2);
    IF v_col_count = 0 THEN
      RAISE EXCEPTION 'body column absent: %', v_col USING ERRCODE = 'P0004';
    END IF;
  END LOOP;

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
