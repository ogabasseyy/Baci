UPDATE public.transactions
SET status = NULL
WHERE id = '33333333-3333-4333-8333-333333333333'::uuid;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SET ROLE service_role;
SELECT public.test_expect_error(
  $$SELECT public.approve_and_complete_uba_redvault_payment(
    '33333333-3333-4333-8333-333333333333'::uuid,
    (SELECT id FROM public.test_result),
    (SELECT evidence FROM public.test_verified_completion_914)
  )$$,
  'redvault_verified_completion_transaction_state_invalid'
);
RESET ROLE;
UPDATE public.transactions
SET status = 'pending'
WHERE id = '33333333-3333-4333-8333-333333333333'::uuid;
DO $$
BEGIN
  IF (SELECT state FROM private.uba_redvault_payment_attempts LIMIT 1) IS DISTINCT FROM 'captured_held'
    OR (SELECT count(*) FROM private.uba_redvault_redemptions) <> 0 THEN
    RAISE EXCEPTION 'null transaction status changed REDVAULT approval state';
  END IF;
END;
$$;
SELECT 'REDVAULT 917 null transaction-state guard passed' AS result;
