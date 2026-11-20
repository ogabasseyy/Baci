-- Exercise the timeout and recovery RPCs against the chronological replay
-- database, including the real inventory and cancelled-order triggers.
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  merchant_id uuid := gen_random_uuid();
  product_id uuid := gen_random_uuid();
  order_id uuid := gen_random_uuid();
  capture_id uuid := gen_random_uuid();
  customer_email text := order_id::text || '@example.test';
BEGIN
  IF has_function_privilege('anon', 'public.reinstate_timeout_order_payment(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.reinstate_timeout_order_payment(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Recovery can run without the verified payment role';
  END IF;

  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (merchant_id, customer_email, 'Late payment replay test', 'late-' || left(merchant_id::text, 8));
  INSERT INTO public.products (id, merchant_id, name, slug, price, status, inventory_tracking_policy)
  VALUES (product_id, merchant_id, 'Replay item', 'replay-item', 150, 'active', 'off');
  INSERT INTO public.orders (
    id, merchant_id, customer_email, order_number, total, subtotal, currency,
    source, payment_method, payment_status, shipping_status, created_at, updated_at, notes
  ) VALUES (
    order_id, merchant_id, customer_email, 'LATE-' || left(order_id::text, 8), 150, 150, 'NGN',
    'mobile_app', 'credit_direct', 'bnpl_pending', 'pending',
    now() - interval '4 days', now() - interval '4 days',
    jsonb_build_object('creditDirectTransactionId', capture_id::text)::text
  );
  INSERT INTO public.order_items (order_id, product_id, name, price, quantity)
  VALUES (order_id, product_id, 'Replay item', 150, 1);
  INSERT INTO public.transactions (
    id, merchant_id, order_id, amount, currency, status, transaction_type, gateway, gateway_reference, gateway_response
  ) VALUES (
    capture_id, merchant_id, order_id, 150, 'NGN', 'completed', 'payment', 'credit_direct', capture_id::text,
    jsonb_build_object('eventType', 'Checkout_Merchant_Payment_Completed',
      'checkoutTransactionId', capture_id::text, 'timeStamp', now())
  );

  PERFORM public.mark_abandoned_orders(72);
  IF NOT EXISTS (SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND o.payment_status = 'cancelled' AND o.cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Timeout did not cancel the Credit Direct order';
  END IF;
  IF public.reinstate_timeout_order_payment(order_id, capture_id) IS DISTINCT FROM 'reinstated' THEN
    RAISE EXCEPTION 'Verified Credit Direct payment did not reinstate the order';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND o.payment_status = 'paid' AND o.shipping_status = 'processing'
      AND o.cancelled_at IS NULL AND o.paid_transaction_id = capture_id AND o.amount_paid = 150) THEN
    RAISE EXCEPTION 'Recovered order did not retain the original capture';
  END IF;
  IF public.reinstate_timeout_order_payment(order_id, capture_id) IS DISTINCT FROM 'already_reinstated' THEN
    RAISE EXCEPTION 'The original capture was not safe to replay';
  END IF;
END;
$$;

ROLLBACK;
