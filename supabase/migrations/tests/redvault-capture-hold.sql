INSERT INTO public.transactions(
  id, order_id, merchant_id, amount, currency, gateway, gateway_reference,
  status, transaction_type
)
SELECT
  '33333333-3333-4333-8333-333333333333'::uuid,
  result.id,
  '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid,
  attempt.amount_kobo / 100.0,
  'NGN',
  'paystack',
  attempt.reference,
  'pending',
  'payment'
FROM public.test_result AS result
CROSS JOIN public.test_attempt AS attempt;

GRANT SELECT ON public.test_result, public.test_attempt TO service_role;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SET ROLE service_role;

SELECT public.capture_or_hold_uba_redvault_payment(
  '33333333-3333-4333-8333-333333333333'::uuid,
  (SELECT id FROM public.test_result),
  'paystack',
  (SELECT reference FROM public.test_attempt LIMIT 1),
  jsonb_build_object(
    'amount', (SELECT amount_kobo FROM public.test_attempt LIMIT 1),
    'currency', 'NGN',
    'reference', (SELECT reference FROM public.test_attempt LIMIT 1),
    'status', 'success'
  )
);

RESET ROLE;

DO $$
BEGIN
  IF (SELECT state FROM private.uba_redvault_payment_attempts LIMIT 1) IS DISTINCT FROM 'captured_held' THEN
    RAISE EXCEPTION 'REDVAULT capture was not held';
  END IF;
  IF (SELECT payment_status FROM public.orders WHERE id = (SELECT id FROM public.test_result)) = 'paid' THEN
    RAISE EXCEPTION 'REDVAULT hold marked the order paid';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SET ROLE service_role;

SELECT public.capture_or_hold_uba_redvault_payment(
  '33333333-3333-4333-8333-333333333333'::uuid,
  (SELECT id FROM public.test_result),
  'paystack',
  (SELECT reference FROM public.test_attempt LIMIT 1),
  jsonb_build_object(
    'amount', (SELECT amount_kobo FROM public.test_attempt LIMIT 1),
    'currency', 'NGN',
    'reference', (SELECT reference FROM public.test_attempt LIMIT 1),
    'status', 'success'
  )
) AS duplicate_capture_must_be_held;

SELECT public.test_expect_error(
  $$SELECT public.capture_or_hold_uba_redvault_payment(
    '33333333-3333-4333-8333-333333333333'::uuid,
    (SELECT id FROM public.test_result), 'paystack', 'wrong-reference',
    jsonb_build_object('amount', (SELECT amount_kobo FROM public.test_attempt LIMIT 1), 'currency', 'NGN', 'reference', 'wrong-reference', 'status', 'success')
  )$$,
  'redvault_capture_evidence_conflict'
);

RESET ROLE;
