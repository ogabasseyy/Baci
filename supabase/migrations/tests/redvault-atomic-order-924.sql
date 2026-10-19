BEGIN;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_rate_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_rate_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_pickup_details jsonb;
CREATE TABLE IF NOT EXISTS public.merchant_shipping_rates(id uuid PRIMARY KEY, merchant_id uuid);
INSERT INTO public.merchant_shipping_rates VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '6b5cb8a4-5575-456c-b936-8cdfae30db74');
CREATE TABLE public.test_atomic_reservations(order_id uuid);
CREATE FUNCTION public.test_atomic_reserve() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.test_atomic_reservations VALUES (NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_atomic_reserve AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.test_atomic_reserve();
CREATE FUNCTION public.test_atomic_attachment_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'pending' AND current_setting('test.fail_atomic_attachment', true) = 'yes' THEN
    RAISE EXCEPTION 'test_attachment_failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_atomic_attachment_failure BEFORE UPDATE ON private.uba_redvault_applications
  FOR EACH ROW EXECUTE FUNCTION public.test_atomic_attachment_failure();
CREATE FUNCTION public.test_sign_atomic(p_order jsonb, p_quote jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_proof jsonb := public.test_sign(jsonb_build_object('order', p_order, 'quote', p_quote));
  v_signature text;
BEGIN
  v_signature := encode(extensions.hmac(
    'quiz-rpc-proof:v1' || E'\nquiz_phase1a\nstorefront_redvault_order_create\n6b5cb8a4-5575-456c-b936-8cdfae30db74\nguest\n'
      || (v_proof->>'issued_at') || E'\n' || (v_proof->>'payload_hash'),
    'local-fixture-only', 'sha256'), 'hex');
  RETURN v_proof || jsonb_build_object('action', 'storefront_redvault_order_create',
    'signature', v_signature, 'proof_id', left(v_signature, 24));
END;
$$;
SELECT set_config('request.jwt.claims','{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}',true);
DO $$
DECLARE
  v_order jsonb;
  v_quote jsonb;
  v_result record;
  v_replay record;
  v_count integer;
  v_application_count integer;
  v_allocations integer;
BEGIN
  SELECT order_input || jsonb_build_object('checkout_idempotency_key','atomic-924',
    'expected_total', NULL,
    'merchant_fulfillment', jsonb_build_object('provider','MERCHANT_PICKUP',
      'rate_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rate_name','Collect',
      'pickup_details', jsonb_build_object('address','1 Test Street'))), quote
    INTO STRICT v_order, v_quote FROM public.test_input;
  SELECT count(*) INTO v_count FROM public.orders;
  SELECT count(*) INTO v_application_count FROM private.uba_redvault_applications;
  SELECT count(*) INTO v_allocations FROM private.uba_redvault_line_allocations;
  PERFORM set_config('test.fail_atomic_attachment','yes',true);
  PERFORM public.test_expect_error(format(
    'SELECT public.create_storefront_redvault_order(%L::jsonb,%L::jsonb,%L::jsonb)',
    v_order, v_quote, public.test_sign_atomic(v_order,v_quote)), 'test_attachment_failure');
  IF (SELECT count(*) FROM public.orders) <> v_count
    OR (SELECT count(*) FROM private.uba_redvault_applications) <> v_application_count
    OR (SELECT count(*) FROM private.uba_redvault_line_allocations) <> v_allocations
    OR EXISTS (SELECT 1 FROM public.test_atomic_reservations)
    OR EXISTS (SELECT 1 FROM private.uba_redvault_write_context) THEN
    RAISE EXCEPTION 'atomic_failure_leaked_order_application_allocation_or_reservation';
  END IF;
  PERFORM set_config('test.fail_atomic_attachment','no',true);
  SELECT * INTO STRICT v_result FROM public.create_storefront_redvault_order(v_order,v_quote,public.test_sign_atomic(v_order,v_quote));
  SELECT * INTO STRICT v_replay FROM public.create_storefront_redvault_order(v_order,v_quote,public.test_sign_atomic(v_order,v_quote));
  IF v_result.status <> 'pending' OR v_result.id IS DISTINCT FROM v_replay.id
    OR (SELECT count(*) FROM public.test_atomic_reservations) <> 1
    OR (SELECT count(*) FROM public.orders) <> v_count + 1 THEN
    RAISE EXCEPTION 'atomic_response_loss_replay_duplicated_order';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_result.id
    AND shipping_provider = 'MERCHANT_PICKUP' AND shipping_rate_name = 'Collect'
    AND shipping_rate_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    AND shipping_pickup_details->>'address' = '1 Test Street'
    AND payment_method = 'uba_redvault' AND payment_status = 'unpaid')
    OR NOT EXISTS (SELECT 1 FROM private.uba_redvault_applications AS application
      JOIN private.redvault_discount_proof_replay AS proof ON proof.proof_id = application.proof_id
      WHERE application.order_id = v_result.id AND application.status = 'pending'
        AND proof.order_id = application.order_id AND proof.quote_version_id = application.quote_version_id) THEN
    RAISE EXCEPTION 'atomic_fulfillment_or_item_bound_proof_missing';
  END IF;
  PERFORM public.test_expect_error(format(
    'SELECT public.create_storefront_redvault_order(%L::jsonb,%L::jsonb,%L::jsonb)',
    v_order || '{"merchant_fulfillment":{"provider":"MERCHANT"}}', v_quote, public.test_sign_atomic(v_order,v_quote)), 'redvault_proof_rejected');
  DELETE FROM public.merchant_shipping_rates WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_order := v_order || '{"checkout_idempotency_key":"atomic-deleted-rate-924"}';
  PERFORM public.test_expect_error(format(
    'SELECT public.create_storefront_redvault_order(%L::jsonb,%L::jsonb,%L::jsonb)',
    v_order, v_quote, public.test_sign_atomic(v_order,v_quote)), 'redvault_fulfillment_rate_not_found');
  INSERT INTO public.merchant_shipping_rates VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  PERFORM public.test_expect_error(format(
    'SELECT public.create_storefront_redvault_order(%L::jsonb,%L::jsonb,%L::jsonb)',
    v_order, v_quote, public.test_sign_atomic(v_order,v_quote)), 'redvault_fulfillment_rate_not_found');
  IF (SELECT count(*) FROM public.orders) <> v_count + 1
    OR (SELECT count(*) FROM public.test_atomic_reservations) <> 1 THEN
    RAISE EXCEPTION 'invalid_rate_leaked_order_or_reservation';
  END IF;
  UPDATE public.merchant_shipping_rates SET merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_order := v_order || '{"checkout_idempotency_key":"atomic-924"}';
  v_order := jsonb_set(v_order, '{merchant_fulfillment,rate_name}', '"Changed"');
  PERFORM public.test_expect_error(format(
    'SELECT public.create_storefront_redvault_order(%L::jsonb,%L::jsonb,%L::jsonb)',
    v_order, v_quote, public.test_sign_atomic(v_order,v_quote)), 'checkout_idempotency_conflict');
  v_order := v_order || '{"checkout_idempotency_key":"atomic-ship-924","merchant_fulfillment":{"provider":"MERCHANT","rate_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","rate_name":"Local delivery","pickup_details":null}}';
  SELECT * INTO STRICT v_result FROM public.create_storefront_redvault_order(v_order,v_quote,public.test_sign_atomic(v_order,v_quote));
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_result.id AND shipping_provider = 'MERCHANT'
    AND shipping_rate_name = 'Local delivery' AND shipping_pickup_details IS NULL) THEN
    RAISE EXCEPTION 'merchant_shipping_metadata_missing';
  END IF;
END;
$$;
SET LOCAL ROLE authenticated;
SELECT public.test_expect_error('SELECT public.create_storefront_redvault_order_draft(order_input,quote) FROM public.test_input','permission denied');
SELECT public.test_expect_error('SELECT public.create_storefront_redvault_order(order_input,quote,NULL) FROM public.test_input','redvault_proof_rejected');
RESET ROLE;
SELECT 'Atomic order creation, rollback, fulfillment, and replay checks passed' AS result;
ROLLBACK;
