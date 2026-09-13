-- This test executes the exact private/public inventory confirmation definition
-- extracted from 20260615181534_serialized_variant_inventory.sql by the runner.
UPDATE public.products
SET has_variants = true, inventory_tracking_policy = 'serialized_strict'
WHERE id = '11111111-1111-4111-8111-111111111111'::uuid;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SET ROLE service_role;
SELECT public.reserve_uba_redvault_refund(
  (SELECT attempt_id FROM public.test_attempt),
  '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid,
  'approval-race-pending-refund',
  'full_capture',
  NULL
);
SELECT public.test_expect_error(
  $$SELECT public.approve_and_complete_uba_redvault_payment(
    '33333333-3333-4333-8333-333333333333'::uuid,
    (SELECT id FROM public.test_result),
    (SELECT evidence FROM public.test_verified_completion_914)
  )$$,
  'redvault_verified_completion_refund_pending'
);
RESET ROLE;
DELETE FROM private.uba_redvault_refunds
WHERE idempotency_key = 'approval-race-pending-refund';
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

RESET ROLE;
DO $$
BEGIN
  IF (SELECT state FROM private.uba_redvault_payment_attempts LIMIT 1) IS DISTINCT FROM 'captured_held'
    OR (SELECT status FROM private.uba_redvault_applications LIMIT 1) IS DISTINCT FROM 'pending'
    OR (SELECT payment_status FROM public.orders WHERE id = (SELECT id FROM public.test_result)) IS DISTINCT FROM 'unpaid'
    OR (SELECT status FROM public.transactions WHERE id = '33333333-3333-4333-8333-333333333333'::uuid) IS DISTINCT FROM 'pending'
    OR (SELECT count(*) FROM private.uba_redvault_redemptions) <> 0
    OR EXISTS (SELECT 1 FROM public.payment_side_effects) THEN
    RAISE EXCEPTION 'inventory confirmation failure did not roll back REDVAULT approval atomically';
  END IF;
END;
$$;

UPDATE public.products
SET inventory_tracking_policy = 'off'
WHERE id = '11111111-1111-4111-8111-111111111111'::uuid;
SELECT 'REDVAULT 916 real inventory rollback-and-retry checks passed' AS result;
