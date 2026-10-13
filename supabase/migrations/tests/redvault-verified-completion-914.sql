-- Parent runner order: after a held capture, before any positive approval call.
-- The fixture must configure paystack_verification_domain = 'test' before reserving.
CREATE TABLE public.test_verified_completion_914 AS
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
  'providerVerificationId', 'synthetic-verified-transaction-914',
  'reference', attempt.reference,
  'verificationSource', 'paystack_transaction_verify',
  'verifiedAt', '2026-09-12T09:14:00.000Z'
) AS evidence
FROM private.uba_redvault_payment_attempts AS attempt
WHERE attempt.state = 'captured_held';
GRANT SELECT ON public.test_verified_completion_914 TO service_role;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SET ROLE service_role;
SELECT public.test_expect_error(
  $$SELECT public.approve_and_complete_uba_redvault_payment(
    '33333333-3333-4333-8333-333333333333'::uuid,
    (SELECT id FROM public.test_result),
    jsonb_set((SELECT evidence FROM public.test_verified_completion_914), '{cardBrand}', 'null'::jsonb)
  )$$,
  'redvault_verified_evidence_invalid'
);
SELECT public.test_expect_error(
  $$SELECT public.approve_and_complete_uba_redvault_payment(
    '33333333-3333-4333-8333-333333333333'::uuid,
    (SELECT id FROM public.test_result),
    jsonb_set((SELECT evidence FROM public.test_verified_completion_914), '{domain}', '"live"'::jsonb)
  )$$,
  'redvault_verified_evidence_invalid'
);
RESET ROLE;
SELECT 'REDVAULT 914 null evidence and domain-binding checks passed' AS result;
