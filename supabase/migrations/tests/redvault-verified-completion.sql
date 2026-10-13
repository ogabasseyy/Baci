CREATE TABLE public.test_verified_completion AS
SELECT jsonb_build_object(
    'acceptedFilterPolicyHash', attempt.accepted_filter_policy_hash,
    'amountKobo', attempt.amount_kobo,
    'cardBrand', 'visa',
    'cardChannel', 'card',
    'contractVersion', 'paystack_verified_card_v1',
    'currency', 'NGN',
    'customerEmail', 'customer@example.test',
    'domain', 'test',
    'issuerName', 'UBA TEST BANK',
    'providerVerificationId', 'synthetic-verified-transaction-1',
    'reference', attempt.reference,
    'verificationSource', 'paystack_transaction_verify',
    'verifiedAt', '2026-09-12T09:13:00.000Z'
  ) AS evidence
FROM private.uba_redvault_payment_attempts AS attempt;
GRANT SELECT ON public.test_verified_completion TO service_role;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SET ROLE service_role;

SELECT public.approve_and_complete_uba_redvault_payment(
  '33333333-3333-4333-8333-333333333333'::uuid,
  (SELECT id FROM public.test_result),
  (SELECT evidence FROM public.test_verified_completion)
) AS verified_completion;

SELECT public.approve_and_complete_uba_redvault_payment(
  '33333333-3333-4333-8333-333333333333'::uuid,
  (SELECT id FROM public.test_result),
  (SELECT evidence FROM public.test_verified_completion)
) AS verified_completion_replay;

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
) AS approved_capture_replay;

SELECT public.test_expect_error(
  $$SELECT public.approve_and_complete_uba_redvault_payment(
    '33333333-3333-4333-8333-333333333333'::uuid,
    (SELECT id FROM public.test_result),
    jsonb_set((SELECT evidence FROM public.test_verified_completion), '{acceptedFilterPolicyHash}', to_jsonb(repeat('0', 64)))
  )$$,
  'redvault_verified_evidence_invalid'
);

RESET ROLE;
DO $$
BEGIN
  IF (SELECT state FROM private.uba_redvault_payment_attempts LIMIT 1) IS DISTINCT FROM 'approved'
    OR (SELECT status FROM private.uba_redvault_applications LIMIT 1) IS DISTINCT FROM 'approved'
    OR (SELECT payment_status FROM public.orders WHERE id = (SELECT id FROM public.test_result)) IS DISTINCT FROM 'paid'
    OR (SELECT status FROM public.transactions WHERE id = '33333333-3333-4333-8333-333333333333'::uuid) IS DISTINCT FROM 'completed'
    OR (SELECT count(*) FROM private.uba_redvault_redemptions) <> 1 THEN
    RAISE EXCEPTION 'verified completion did not atomically approve and redeem';
  END IF;
END;
$$;
SELECT 'Verified completion approval, replay, and mismatch checks passed' AS result;
