BEGIN;

SELECT plan(1);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- A GIG-side cancellation (SSC or the preshipment IsCancelled read) must only
-- cancel the shipment. It may set shipping_status for the latest shipment
-- generation but must never change the paid order's own status.
DO $test$
DECLARE
  v_merchant_id uuid := '63a63d82-0000-4000-8000-000000000601';
  v_order_id uuid := '63a63d82-0000-4000-8000-000000000602';
  v_old_shipment_id uuid;
  v_current_shipment_id uuid;
  v_shipping_status text;
  v_order_status text;
  v_status_before text;
  v_shipping_before text;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    'gigl-cancel-generation@example.com',
    'GIGL Cancel Generation',
    'gigl-cancel-generation'
  );
  INSERT INTO public.orders (id, merchant_id, order_number, total)
  VALUES (v_order_id, v_merchant_id, 'GIGL-CANCEL-GEN-001', 1000);
  INSERT INTO public.shipments (
    order_id, merchant_id, provider, tracking_number,
    sender_address, receiver_address, items
  ) VALUES (
    v_order_id, v_merchant_id, 'GIGL', 'GIGL-CANCEL-OLD',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
  ) RETURNING id INTO v_old_shipment_id;
  INSERT INTO public.shipments (
    order_id, merchant_id, provider, tracking_number,
    sender_address, receiver_address, items
  ) VALUES (
    v_order_id, v_merchant_id, 'GIGL', 'GIGL-CANCEL-CURRENT',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
  ) RETURNING id INTO v_current_shipment_id;

  UPDATE public.shipments SET status = 'in_transit'
  WHERE id = v_current_shipment_id;
  SELECT status::text, shipping_status INTO v_status_before, v_shipping_before
  FROM public.orders WHERE id = v_order_id;

  -- Older generation cancelled: order must be completely untouched.
  UPDATE public.shipments SET status = 'cancelled'
  WHERE id = v_old_shipment_id;
  SELECT status::text, shipping_status INTO v_order_status, v_shipping_status
  FROM public.orders WHERE id = v_order_id;
  IF v_order_status IS DISTINCT FROM v_status_before
     OR v_shipping_status IS DISTINCT FROM v_shipping_before THEN
    RAISE EXCEPTION
      'cancelling an older-generation shipment must leave the order untouched';
  END IF;

  -- Latest generation cancelled: only shipping_status moves, never status.
  UPDATE public.shipments SET status = 'cancelled'
  WHERE id = v_current_shipment_id;
  SELECT status::text, shipping_status INTO v_order_status, v_shipping_status
  FROM public.orders WHERE id = v_order_id;
  IF v_order_status IS DISTINCT FROM v_status_before THEN
    RAISE EXCEPTION 'a cancelled shipment must not cancel the paid order';
  END IF;
  IF v_shipping_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION
      'the latest-generation cancelled shipment must set shipping_status';
  END IF;
END;
$test$;

SELECT pass('cancelled GIGL shipments never cancel the order itself');

SELECT * FROM finish();
ROLLBACK;
