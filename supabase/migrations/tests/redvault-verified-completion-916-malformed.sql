-- Explicit test-only seam for malformed RPC contracts. The runner reinstalls the
-- exact inventory definition before the separate real-inventory scenario.
CREATE TABLE public.redvault_test_inventory_override(result jsonb);
INSERT INTO public.redvault_test_inventory_override VALUES (NULL);
GRANT SELECT, UPDATE ON public.redvault_test_inventory_override TO service_role;
CREATE OR REPLACE FUNCTION public.confirm_order_inventory_reservations(
  p_merchant_id uuid,
  p_order_id uuid
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
  SELECT result FROM public.redvault_test_inventory_override LIMIT 1
$$;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SET ROLE service_role;
SELECT public.test_expect_error(
  $$SELECT public.approve_and_complete_uba_redvault_payment(
    '33333333-3333-4333-8333-333333333333'::uuid,
    (SELECT id FROM public.test_result),
    (SELECT evidence FROM public.test_verified_completion_914)
  )$$,
  'redvault_inventory_confirmation_unavailable'
);
UPDATE public.redvault_test_inventory_override SET result = 'null'::jsonb;
SELECT public.test_expect_error(
  $$SELECT public.approve_and_complete_uba_redvault_payment(
    '33333333-3333-4333-8333-333333333333'::uuid,
    (SELECT id FROM public.test_result),
    (SELECT evidence FROM public.test_verified_completion_914)
  )$$,
  'redvault_inventory_confirmation_unavailable'
);
UPDATE public.redvault_test_inventory_override SET result = '{"reclaimedUnitCount":0}'::jsonb;
SELECT public.test_expect_error(
  $$SELECT public.approve_and_complete_uba_redvault_payment(
    '33333333-3333-4333-8333-333333333333'::uuid,
    (SELECT id FROM public.test_result),
    (SELECT evidence FROM public.test_verified_completion_914)
  )$$,
  'redvault_inventory_confirmation_unavailable'
);
UPDATE public.redvault_test_inventory_override
SET result = '{"reclaimedUnitCount":0,"exceptionCodes":[{"itemId":"fixture","code":"late_payment_reservation_lost"}]}'::jsonb;
SELECT public.test_expect_error(
  $$SELECT public.approve_and_complete_uba_redvault_payment(
    '33333333-3333-4333-8333-333333333333'::uuid,
    (SELECT id FROM public.test_result),
    (SELECT evidence FROM public.test_verified_completion_914)
  )$$,
  'redvault_inventory_confirmation_unavailable'
);
RESET ROLE;
DO $$
BEGIN
  IF (SELECT state FROM private.uba_redvault_payment_attempts LIMIT 1) IS DISTINCT FROM 'captured_held'
    OR (SELECT status FROM private.uba_redvault_applications LIMIT 1) IS DISTINCT FROM 'pending'
    OR (SELECT payment_status FROM public.orders WHERE id = (SELECT id FROM public.test_result)) IS DISTINCT FROM 'unpaid'
    OR (SELECT status FROM public.transactions WHERE id = '33333333-3333-4333-8333-333333333333'::uuid) IS DISTINCT FROM 'pending'
    OR (SELECT count(*) FROM private.uba_redvault_redemptions) <> 0
    OR EXISTS (SELECT 1 FROM public.payment_side_effects) THEN
    RAISE EXCEPTION 'malformed inventory confirmation altered REDVAULT completion state';
  END IF;
END;
$$;
SELECT 'REDVAULT 916 malformed inventory receipt checks passed' AS result;
