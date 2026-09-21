BEGIN;
INSERT INTO private.uba_redvault_write_context VALUES (txid_current());
UPDATE public.orders SET payment_status = 'paid' WHERE id = (SELECT id FROM public.test_result);
UPDATE public.transactions SET status = 'completed' WHERE id = '33333333-3333-4333-8333-333333333333'::uuid;
DELETE FROM private.uba_redvault_write_context WHERE transaction_id = txid_current();
GRANT SELECT ON public.transactions TO service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SET ROLE service_role;
SELECT public.capture_or_hold_uba_redvault_payment(
  '33333333-3333-4333-8333-333333333333'::uuid,
  (SELECT id FROM public.test_result), 'paystack',
  (SELECT reference FROM public.test_attempt LIMIT 1),
  jsonb_build_object('reference', (SELECT reference FROM public.test_attempt LIMIT 1),
    'amount', (SELECT amount_kobo FROM public.test_attempt LIMIT 1), 'currency', 'NGN', 'status', 'success', 'fees', 100)
);
SELECT public.approve_and_complete_uba_redvault_payment(
  '33333333-3333-4333-8333-333333333333'::uuid, (SELECT id FROM public.test_result),
  (SELECT evidence FROM public.test_verified_completion)
);
SELECT public.capture_or_hold_uba_redvault_payment(
  '33333333-3333-4333-8333-333333333333'::uuid,
  (SELECT id FROM public.test_result), 'paystack',
  (SELECT reference FROM public.test_attempt LIMIT 1),
  (SELECT gateway_response FROM public.transactions WHERE id = '33333333-3333-4333-8333-333333333333'::uuid)
);
RESET ROLE;
DO $$ DECLARE v_state text;
BEGIN
  FOREACH v_state IN ARRAY ARRAY['approved', 'captured_held'] LOOP
    UPDATE private.uba_redvault_payment_attempts SET state = v_state WHERE id = (SELECT attempt_id FROM public.test_attempt LIMIT 1);
    PERFORM public.test_expect_error($query$
      SELECT public.capture_or_hold_uba_redvault_payment(
        '33333333-3333-4333-8333-333333333333'::uuid,
        (SELECT id FROM public.test_result), 'paystack',
        (SELECT reference FROM public.test_attempt LIMIT 1),
        (SELECT jsonb_set(gateway_response, '{fees}', '0') FROM public.transactions WHERE id = '33333333-3333-4333-8333-333333333333'::uuid))
    $query$, 'redvault_capture_fee_conflict');
  END LOOP;
END $$;
DO $$ DECLARE v_response jsonb;
BEGIN
  SELECT gateway_response INTO STRICT v_response FROM public.transactions WHERE id = '33333333-3333-4333-8333-333333333333'::uuid;
  IF NOT (v_response ?& ARRAY['reference','amount','currency','status','paid_at','fees'])
    OR v_response->'fees' IS DISTINCT FROM '100'::jsonb
    OR (SELECT count(*) FROM jsonb_object_keys(v_response)) <> 6 THEN
    RAISE EXCEPTION 'REDVAULT replay evidence is missing or contains unnecessary provider fields';
  END IF;
END $$;
ROLLBACK;
SELECT 'REDVAULT stored capture verification replay passed' AS result;
