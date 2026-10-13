SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SET ROLE service_role;
DO $$
DECLARE
  capture_status text;
  receipt jsonb;
BEGIN
  FOREACH capture_status IN ARRAY ARRAY['failed', 'pending', '', NULL::text] LOOP
    BEGIN
      PERFORM public.capture_or_hold_uba_redvault_payment(
        '33333333-3333-4333-8333-333333333333'::uuid,
        (SELECT id FROM public.test_result), 'paystack',
        (SELECT reference FROM public.test_attempt LIMIT 1),
        jsonb_build_object(
          'amount', (SELECT amount_kobo FROM public.test_attempt LIMIT 1),
          'currency', 'NGN',
          'reference', (SELECT reference FROM public.test_attempt LIMIT 1),
          'status', capture_status
        )
      );
      RAISE EXCEPTION 'conflicting capture status accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'redvault_capture_evidence_conflict' THEN RAISE; END IF;
    END;
  END LOOP;
  receipt := public.capture_or_hold_uba_redvault_payment(
    '33333333-3333-4333-8333-333333333333'::uuid,
    (SELECT id FROM public.test_result), 'paystack',
    (SELECT reference FROM public.test_attempt LIMIT 1),
    jsonb_build_object(
      'amount', (SELECT amount_kobo FROM public.test_attempt LIMIT 1),
      'currency', 'NGN',
      'reference', (SELECT reference FROM public.test_attempt LIMIT 1),
      'status', 'success'
    )
  );
  IF receipt->>'kind' IS DISTINCT FROM 'captured_held'
    OR receipt->>'duplicate' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'matching duplicate capture changed';
  END IF;
END;
$$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM private.uba_redvault_payment_attempts
    WHERE order_id = (SELECT id FROM public.test_result)
      AND (state <> 'captured_held' OR captured_at IS NULL
        OR provider_response->>'capture_status' IS DISTINCT FROM 'success')
  ) THEN
    RAISE EXCEPTION 'replay changed durable capture proof';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE payment_status = 'paid') THEN
    RAISE EXCEPTION 'replay marked order paid';
  END IF;
END;
$$;
SELECT 'Capture status replay checks passed' AS result;
