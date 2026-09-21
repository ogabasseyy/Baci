INSERT INTO public.orders(id, merchant_id, customer_email, payment_method, payment_status, total)
VALUES (
  '55555555-5555-4555-8555-555555555555'::uuid,
  '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid,
  'ordinary@example.test',
  'paystack',
  'unpaid',
  100
);

SELECT public.test_expect_error(
  $$UPDATE public.order_items
    SET order_id = '55555555-5555-4555-8555-555555555555'::uuid
    WHERE order_id = (SELECT id FROM public.test_result)$$,
  'redvault_order_snapshot_immutable'
);

SELECT public.test_expect_error(
  $$INSERT INTO public.order_items(order_id, line_id, product_id, price, quantity)
    SELECT id, 2, '11111111-1111-4111-8111-111111111111'::uuid, 100, 1
    FROM public.test_result$$,
  'redvault_order_snapshot_immutable'
);

DO $$
BEGIN
  IF (SELECT fulfillment_data->>'source' FROM public.order_items WHERE order_id = (SELECT id FROM public.test_result) LIMIT 1) IS DISTINCT FROM 'merchant_stock' THEN
    RAISE EXCEPTION 'actual fulfillment update was not preserved before membership regression';
  END IF;
END;
$$;

SELECT 'REDVAULT 921 item membership and actual fulfillment checks passed' AS result;
