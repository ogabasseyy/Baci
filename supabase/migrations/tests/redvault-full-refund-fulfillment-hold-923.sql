SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SET ROLE service_role;

DO $$
DECLARE reserved_refund record; claimed_refund record;
BEGIN
  SELECT * INTO reserved_refund
  FROM public.reserve_uba_redvault_refund(
    (SELECT attempt_id FROM public.test_attempt),
    '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid,
    'postapproval-full-refund-hold',
    'full_capture',
    NULL
  );
  SELECT * INTO claimed_refund FROM public.claim_next_uba_redvault_refund();
  IF claimed_refund.id IS DISTINCT FROM reserved_refund.id OR claimed_refund.state IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'full capture refund was not claimed';
  END IF;
  SELECT * INTO claimed_refund
  FROM public.finish_uba_redvault_refund(claimed_refund.id, 'processed', 'full-refund-923', 'processed');
  IF claimed_refund.state IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'full capture refund was not processed';
  END IF;
END;
$$;

RESET ROLE;

UPDATE public.products
SET inventory_tracking_policy = 'off'
WHERE id = (SELECT product_id FROM public.order_items WHERE order_id = (SELECT id FROM public.test_result) LIMIT 1);

SELECT public.test_expect_error(
  $$SELECT public.apply_provider_shipment_webhook_status(
    '44444444-4444-4444-8444-444444444444'::uuid,
    'gigl', 'in_transit', 'GIGL-923', '{}'::jsonb, now()
  )$$,
  'redvault_order_requires_protected_path'
);

DO $$
BEGIN
  IF (SELECT state FROM private.uba_redvault_refunds WHERE idempotency_key = 'postapproval-full-refund-hold') IS DISTINCT FROM 'processed'
    OR (SELECT shipping_status FROM public.orders WHERE id = (SELECT id FROM public.test_result)) IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'full capture refund did not hold fulfillment safely';
  END IF;
END;
$$;

SELECT 'REDVAULT 923 processed full-capture refund holds actual shipment RPC' AS result;
