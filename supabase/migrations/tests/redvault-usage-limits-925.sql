BEGIN;

DELETE FROM private.uba_redvault_refund_lifecycle WHERE order_id = (SELECT id FROM public.test_result);
DELETE FROM private.uba_redvault_refund_line_allocations WHERE refund_id IN (
  SELECT refund.id FROM private.uba_redvault_refunds AS refund
  JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
  WHERE attempt.order_id = (SELECT id FROM public.test_result)
);
DELETE FROM private.uba_redvault_refunds WHERE attempt_id IN (
  SELECT id FROM private.uba_redvault_payment_attempts WHERE order_id = (SELECT id FROM public.test_result)
);

CREATE FUNCTION pg_temp.redvault_usage_candidate(p_email text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_application private.uba_redvault_applications%ROWTYPE;
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_application FROM private.uba_redvault_applications LIMIT 1;
  SELECT * INTO STRICT v_order FROM public.orders WHERE id = v_application.order_id;
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts WHERE application_id = v_application.id LIMIT 1;
  v_order.id := gen_random_uuid();
  v_order.customer_email := p_email;
  v_order.payment_status := 'unpaid';
  INSERT INTO private.uba_redvault_write_context VALUES (txid_current()) ON CONFLICT DO NOTHING;
  INSERT INTO public.orders SELECT v_order.*;
  v_application.id := gen_random_uuid();
  v_application.order_id := v_order.id;
  v_application.quote_version_id := gen_random_uuid();
  v_application.checkout_key := v_order.id::text;
  v_application.customer_email := p_email;
  INSERT INTO private.uba_redvault_applications SELECT v_application.*;
  v_attempt.id := gen_random_uuid();
  v_attempt.application_id := v_application.id;
  v_attempt.order_id := v_order.id;
  v_attempt.reference := 'RV-' || v_attempt.id::text;
  INSERT INTO private.uba_redvault_payment_attempts SELECT v_attempt.*;
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = txid_current();
  RETURN v_attempt.id;
END;
$$;

CREATE FUNCTION pg_temp.redeem_redvault_candidate(p_attempt_id uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO private.uba_redvault_redemptions(application_id, attempt_id, discount_code_id,
    order_id, merchant_id, customer_email, amount_kobo, provider_verification_id, accepted_filter_policy_hash)
  SELECT application.id, attempt.id, application.discount_code_id, application.order_id,
    application.merchant_id, application.customer_email, application.discount_kobo,
    'usage-test', repeat('a', 64)
  FROM private.uba_redvault_applications AS application
  JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.application_id = application.id
  WHERE attempt.id = p_attempt_id;
$$;

ALTER TABLE public.discount_codes DISABLE TRIGGER prevent_uba_redvault_discount_mutation;
DELETE FROM private.uba_redvault_redemptions;
UPDATE public.discount_codes SET usage_limit = 1, usage_limit_per_customer = NULL, usage_count = 0;
UPDATE private.uba_redvault_runtime SET commercial_terms = jsonb_set(commercial_terms,
  '{usage_limits}', '{"usage_limit":null,"usage_limit_per_customer":null}');

DO $$
DECLARE v_first uuid; v_second uuid;
BEGIN
  v_first := pg_temp.redvault_usage_candidate('first@example.test');
  v_second := pg_temp.redvault_usage_candidate('second@example.test');
  PERFORM pg_temp.redeem_redvault_candidate(v_first);
  BEGIN
    PERFORM pg_temp.redeem_redvault_candidate(v_second);
    RAISE EXCEPTION 'campaign cap accepted excess redemption';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_campaign_usage_limit_reached' THEN RAISE; END IF;
  END;
END;
$$;

DELETE FROM private.uba_redvault_redemptions;
UPDATE public.discount_codes SET usage_limit = NULL, usage_limit_per_customer = 1;
DO $$
DECLARE v_first uuid; v_second uuid;
BEGIN
  v_first := pg_temp.redvault_usage_candidate(' Person@example.test ');
  v_second := pg_temp.redvault_usage_candidate('person@example.test');
  PERFORM pg_temp.redeem_redvault_candidate(v_first);
  BEGIN
    PERFORM pg_temp.redeem_redvault_candidate(v_second);
    RAISE EXCEPTION 'normalized customer cap accepted excess redemption';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_customer_usage_limit_reached' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.redeem_redvault_candidate(pg_temp.redvault_usage_candidate('other@example.test'));
END;
$$;

DELETE FROM private.uba_redvault_redemptions;
UPDATE public.discount_codes SET usage_limit = 10, usage_limit_per_customer = 10;
UPDATE private.uba_redvault_runtime SET commercial_terms = jsonb_set(commercial_terms,
  '{usage_limits}', '{"usage_limit":0,"usage_limit_per_customer":null}');
INSERT INTO private.uba_redvault_write_context VALUES (txid_current()) ON CONFLICT DO NOTHING;
UPDATE public.orders SET payment_status = 'unpaid' WHERE id = (SELECT id FROM public.test_result);
UPDATE public.transactions SET status = 'pending' WHERE id = '33333333-3333-4333-8333-333333333333';
UPDATE private.uba_redvault_payment_attempts SET state = 'captured_held' WHERE id = (SELECT attempt_id FROM public.test_attempt);
UPDATE private.uba_redvault_applications SET status = 'pending' WHERE order_id = (SELECT id FROM public.test_result);
DELETE FROM private.uba_redvault_write_context WHERE transaction_id = txid_current();
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$
BEGIN
  BEGIN
    PERFORM pg_temp.redeem_redvault_candidate(pg_temp.redvault_usage_candidate('terms@example.test'));
    RAISE EXCEPTION 'stricter commercial zero cap ignored';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_campaign_usage_limit_reached' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.approve_and_complete_uba_redvault_payment(
      '33333333-3333-4333-8333-333333333333', (SELECT id FROM public.test_result),
      (SELECT evidence FROM public.test_verified_completion));
    RAISE EXCEPTION 'approval exceeded zero campaign cap';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_campaign_usage_limit_reached' THEN RAISE; END IF;
  END;
  IF (SELECT payment_status FROM public.orders WHERE id = (SELECT id FROM public.test_result)) <> 'unpaid'
    OR (SELECT state FROM private.uba_redvault_payment_attempts WHERE id = (SELECT attempt_id FROM public.test_attempt)) <> 'captured_held'
    OR (SELECT count(*) FROM private.uba_redvault_redemptions) <> 0 THEN
    RAISE EXCEPTION 'limit rejection failed to roll back approval atomically';
  END IF;
END;
$$;

UPDATE private.uba_redvault_runtime SET commercial_terms = jsonb_set(commercial_terms,
  '{usage_limits}', '"unconfirmed"');
DO $$
BEGIN
  BEGIN
    PERFORM pg_temp.redeem_redvault_candidate(pg_temp.redvault_usage_candidate('unknown@example.test'));
    RAISE EXCEPTION 'unstructured commercial limits accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_usage_limits_unconfirmed' THEN RAISE; END IF;
  END;
END;
$$;

UPDATE private.uba_redvault_runtime SET commercial_terms = jsonb_set(commercial_terms,
  '{usage_limits}', '{"usage_limit":null,"usage_limit_per_customer":null}');
UPDATE public.discount_codes SET usage_limit = 1, usage_count = 1;
DO $$
BEGIN
  BEGIN
    PERFORM pg_temp.redeem_redvault_candidate(pg_temp.redvault_usage_candidate('historical@example.test'));
    RAISE EXCEPTION 'historical campaign usage ignored';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_campaign_usage_limit_reached' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;
SELECT 'REDVAULT 925 campaign, customer, commercial and historical usage caps passed' AS result;
