INSERT INTO public.shipments(id, merchant_id, order_id, provider, status, tracking_number, tracking_history)
VALUES (
  '44444444-4444-4444-8444-444444444444'::uuid,
  '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid,
  (SELECT id FROM public.test_result),
  'gigl',
  'booked',
  NULL,
  '[]'::jsonb
);

UPDATE public.products
SET has_variants = true, inventory_tracking_policy = 'serialized_soft'
WHERE id = (SELECT product_id FROM public.order_items WHERE order_id = (SELECT id FROM public.test_result) LIMIT 1);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SET ROLE service_role;

SELECT public.apply_provider_shipment_webhook_status(
  '44444444-4444-4444-8444-444444444444'::uuid,
  'gigl', 'in_transit', 'GIGL-919', '{}'::jsonb, now()
);

SELECT public.confirm_order_inventory_reservations(
  '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid,
  (SELECT id FROM public.test_result)
) AS actual_inventory_confirmation;

SELECT public.approve_and_complete_uba_redvault_payment(
  '33333333-3333-4333-8333-333333333333'::uuid,
  (SELECT id FROM public.test_result),
  (SELECT evidence FROM public.test_verified_completion)
) AS approved_replay_after_fulfillment;

RESET ROLE;

SELECT public.test_expect_error(
  $$UPDATE public.orders SET total = 1 WHERE id = (SELECT id FROM public.test_result)$$,
  'redvault_order_requires_protected_path'
);
SELECT public.test_expect_error(
  $$UPDATE public.orders SET shipping_status = 'cancelled' WHERE id = (SELECT id FROM public.test_result)$$,
  'redvault_order_requires_protected_path'
);

DO $$
BEGIN
  IF (SELECT shipping_status FROM public.orders WHERE id = (SELECT id FROM public.test_result)) IS DISTINCT FROM 'processing'
    OR (SELECT tracking_number FROM public.shipments WHERE id = '44444444-4444-4444-8444-444444444444'::uuid) IS DISTINCT FROM 'GIGL-919'
    OR (SELECT fulfillment_data->>'source' FROM public.order_items WHERE order_id = (SELECT id FROM public.test_result) LIMIT 1) IS DISTINCT FROM 'merchant_stock'
    OR (SELECT state FROM private.uba_redvault_payment_attempts LIMIT 1) IS DISTINCT FROM 'approved'
    OR (SELECT payment_status FROM public.orders WHERE id = (SELECT id FROM public.test_result)) IS DISTINCT FROM 'paid'
    OR (SELECT count(*) FROM private.uba_redvault_redemptions) <> 1 THEN
    RAISE EXCEPTION 'postapproval fulfillment did not preserve REDVAULT state';
  END IF;
END;
$$;

SELECT 'REDVAULT 919 actual fulfillment RPC, immutable financial state, and approved replay checks passed' AS result;
