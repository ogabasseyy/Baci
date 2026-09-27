CREATE FUNCTION public.test_expect_error(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected IN SQLERRM) = 0 THEN RAISE; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'expected error was absent: %', expected;
END;
$$;
DO $$
DECLARE caught boolean := false;
BEGIN
  BEGIN
    PERFORM public.test_expect_error('SELECT 1', 'deliberately_missing_error');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'expected error was absent: deliberately_missing_error' THEN RAISE; END IF;
    caught := true;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'test_expect_error swallowed its no-error failure'; END IF;
END;
$$;
CREATE FUNCTION public.test_sign(payload jsonb, user_id text DEFAULT 'guest') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE issued text := now()::text; digest text := private.transaction_discount_payload_hash(payload); signature text;
BEGIN
  signature := encode(extensions.hmac('quiz-rpc-proof:v1'||E'\nquiz_phase1a\nstorefront_redvault_discount\n6b5cb8a4-5575-456c-b936-8cdfae30db74\n'||user_id||E'\n'||issued||E'\n'||digest,'local-fixture-only','sha256'),'hex');
  RETURN jsonb_build_object('action','storefront_redvault_discount','subject_id','6b5cb8a4-5575-456c-b936-8cdfae30db74','user_id',user_id,'issued_at',issued,'payload',payload,'payload_hash',digest,'proof_id',left(signature,24),'signature',signature,'scope','quiz_phase1a','version','quiz-rpc-proof:v1');
END;
$$;
INSERT INTO private.quiz_rpc_server_secrets VALUES ('current','local-fixture-only',NULL);
INSERT INTO public.products VALUES ('11111111-1111-4111-8111-111111111111','6b5cb8a4-5575-456c-b936-8cdfae30db74','Samsung','Galaxy S24',100,'new','S',7.5);
INSERT INTO public.discount_codes(id,merchant_id,code,discount_type,discount_value,applies_to,is_active) VALUES ('22222222-2222-4222-8222-222222222222','6b5cb8a4-5575-456c-b936-8cdfae30db74','fixture','percentage',5,'all',true);
INSERT INTO private.uba_redvault_discount_binding(discount_code_id,merchant_id,partnership) VALUES ('22222222-2222-4222-8222-222222222222','6b5cb8a4-5575-456c-b936-8cdfae30db74','uba_redvault');
CREATE TABLE public.test_input(order_input jsonb,quote jsonb);
INSERT INTO public.test_input VALUES (
  '{"merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74","customer_email":"customer@example.test","customer_name":"Fixture","discount_amount":5,"checkout_idempotency_key":"fixture-key","items":[{"product_id":"11111111-1111-4111-8111-111111111111","quantity":1,"condition":"new","variant_attributes":{}}]}',
  '{"discountKobo":500,"eligibleSubtotalKobo":10000,"productSubtotalKobo":10000,"lines":[{"brand":"Samsung","name":"Galaxy S24","condition":"new","discountKobo":500,"lineId":1,"productId":"11111111-1111-4111-8111-111111111111","quantity":1,"unitDiscountsKobo":[500],"unitPriceKobo":10000,"variantAttributes":{},"variantId":null,"vatCategoryCode":"S","vatRateBp":750}],"groups":[{"condition":"new","discountKobo":500,"key":"fixture","lineSubtotalKobo":10000,"members":[{"allocationKobo":500,"lineId":1,"quantity":1}],"productId":"11111111-1111-4111-8111-111111111111","taxInclusive":false,"unitPriceKobo":10000,"variantAttributes":{},"variantId":null,"vatCategoryCode":"S","vatRateBp":750}]}'
);
GRANT SELECT ON public.test_input TO authenticated,anon;
SET ROLE anon;
SELECT public.test_expect_error('SELECT public.create_storefront_redvault_order_draft(order_input,quote) FROM public.test_input','permission denied');
RESET ROLE;
SET ROLE authenticated;
SELECT public.test_expect_error('SELECT public.create_storefront_redvault_order_draft(order_input,quote) FROM public.test_input','redvault_route_context_required');
SELECT set_config('request.jwt.claims','{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}',false);
SELECT public.test_expect_error('SELECT public.create_storefront_redvault_order_draft(order_input,quote) FROM public.test_input','redvault_disabled');
RESET ROLE;
UPDATE private.uba_redvault_runtime SET enabled=true,commercial_terms_confirmed=true;
SELECT public.test_expect_error('SELECT public.create_storefront_redvault_order_draft(order_input,quote) FROM public.test_input','redvault_commercial_terms_missing');
UPDATE private.uba_redvault_runtime SET commercial_terms='{"campaign_dates":"fixture","minimum_spend":"fixture","caps":"fixture","usage_limits":"fixture","stacking":"fixture","split_payments":"fixture","funding_fees":"fixture","refund_usage_restoration":"fixture","operations_owner":"fixture"}';
CREATE TABLE public.test_result AS SELECT draft.* FROM public.test_input CROSS JOIN LATERAL public.create_storefront_redvault_order_draft(order_input,quote) draft;
GRANT SELECT ON public.test_result TO authenticated;
SET ROLE authenticated;
SELECT public.create_storefront_redvault_order_draft(order_input,quote) FROM public.test_input;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.orders) <> 1 OR (SELECT count(*) FROM public.discount_code_usage) <> 0 OR (SELECT count(*) FROM private.uba_redvault_line_allocations) <> 1 THEN RAISE EXCEPTION 'draft/recovery side effects failed'; END IF;
END $$;
CREATE TABLE public.test_proof AS SELECT public.test_sign((proof_context-'applicationId') || jsonb_build_object('version',1,'partnership','uba_redvault','merchantId','6b5cb8a4-5575-456c-b936-8cdfae30db74','customerEmail','customer@example.test','orderId',id,'quoteVersionId',quote_version_id,'quotePayloadHash',quote_payload_hash,'nonce','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) AS proof FROM public.test_result;
GRANT SELECT ON public.test_proof TO authenticated;
SET ROLE authenticated;
SELECT public.attach_storefront_redvault_discount_proof(id,quote_version_id,quote_payload_hash,proof) FROM public.test_result CROSS JOIN public.test_proof;
SELECT public.attach_storefront_redvault_discount_proof(id,quote_version_id,quote_payload_hash,proof) FROM public.test_result CROSS JOIN public.test_proof;
SELECT public.test_expect_error('SELECT public.attach_storefront_redvault_discount_proof(id,quote_version_id,quote_payload_hash,NULL) FROM public.test_result','redvault_customer_context_required');
SELECT public.test_expect_error('SELECT public.attach_storefront_redvault_discount_proof(id,quote_version_id,quote_payload_hash,jsonb_set(proof,''{payload,discountKobo}'',''999'')) FROM public.test_result CROSS JOIN public.test_proof','redvault_proof_rejected');
SELECT set_config('request.jwt.claims','{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',false);
SELECT public.test_expect_error('SELECT public.attach_storefront_redvault_discount_proof(id,quote_version_id,quote_payload_hash,proof) FROM public.test_result CROSS JOIN public.test_proof','redvault_route_context_required');
SELECT set_config('request.jwt.claims','{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74","sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',false);
SELECT public.test_expect_error('SELECT public.attach_storefront_redvault_discount_proof(id,quote_version_id,quote_payload_hash,proof) FROM public.test_result CROSS JOIN public.test_proof','redvault_customer_context_required');
RESET ROLE;
SELECT public.test_expect_error('UPDATE public.orders SET payment_method=''paystack''','redvault_order_requires_protected_path');
SELECT public.test_expect_error('UPDATE public.orders SET payment_status=''paid''','redvault_paid_transition_requires_approved_attempt');
SELECT public.test_expect_error('UPDATE public.order_items SET price=1','redvault_order_snapshot_immutable');
SELECT public.test_expect_error('INSERT INTO public.discount_code_usage VALUES (''22222222-2222-4222-8222-222222222222'')','redvault_discount_requires_protected_path');
SELECT public.test_expect_error('UPDATE public.discount_codes SET minimum_purchase_amount=1','redvault_discount_binding_is_immutable');
SELECT public.test_expect_error('UPDATE public.discount_codes SET merchant_id=''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa''','redvault_discount_binding_is_immutable');
DO $$ BEGIN
  IF (SELECT count(*) FROM private.redvault_discount_proof_replay) <> 1 OR (SELECT count(*) FROM public.discount_code_usage) <> 0 THEN RAISE EXCEPTION 'proof replay or usage invariant failed'; END IF;
END $$;
SELECT 'REDVAULT native behavioral checks passed' AS result;
SELECT set_config('request.jwt.claims','{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}',false);
DO $$
DECLARE original_quote jsonb; bad_quote jsonb; order_input jsonb; altered jsonb;
BEGIN
  SELECT input.quote,input.order_input INTO original_quote,order_input FROM public.test_input input;
  order_input := jsonb_set(order_input,'{checkout_idempotency_key}','"invalid-snapshot"');
  FOREACH bad_quote IN ARRAY ARRAY[
    jsonb_set(original_quote,'{lines,0,unitPriceKobo}','1'),
    jsonb_set(original_quote,'{lines,0,variantAttributes}','{"color":"forged"}'),
    jsonb_set(original_quote,'{lines,0,brand}','"Forged"'),
    jsonb_set(original_quote,'{lines,0,vatRateBp}','0'),
    jsonb_set(original_quote,'{lines,0,quantity}','10001'),
    jsonb_set(original_quote,'{lines,0,unitDiscountsKobo}','[499]')
  ] LOOP
    BEGIN
      PERFORM public.create_storefront_redvault_order_draft(order_input,bad_quote);
      RAISE EXCEPTION 'bad snapshot accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT IN ('redvault_order_snapshot_mismatch','redvault_allocation_limit','redvault_allocation_invalid') THEN RAISE; END IF;
    END;
  END LOOP;
  FOR altered IN SELECT proof #- ARRAY['payload',key] FROM public.test_proof CROSS JOIN unnest(ARRAY['version','merchantId','orderId','quoteVersionId','customerEmail','groups','taxBasis']) AS keys(key) LOOP
    BEGIN
      PERFORM public.attach_storefront_redvault_discount_proof(id,quote_version_id,quote_payload_hash,altered) FROM public.test_result;
      RAISE EXCEPTION 'missing proof field accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'redvault_proof_rejected' THEN RAISE; END IF; END;
  END LOOP;
  IF (SELECT count(*) FROM public.orders) <> 1 THEN RAISE EXCEPTION 'invalid snapshot leaked order'; END IF;
END $$;
SELECT set_config('app.redvault_order_draft_context','1',false);
SELECT public.test_expect_error('UPDATE public.orders SET payment_method=''paystack''','redvault_order_requires_protected_path');
SELECT public.test_expect_error('DELETE FROM public.discount_codes','redvault_discount_binding_is_immutable');
SELECT public.test_expect_error('UPDATE public.discount_codes SET usage_count=1','redvault_discount_binding_is_immutable');

BEGIN;
INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current());
UPDATE public.orders SET total = 95 WHERE id = (SELECT id FROM public.test_result);
DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
COMMIT;
SET ROLE authenticated;
SELECT public.test_expect_error('SELECT public.reserve_storefront_redvault_payment_attempt(id) FROM public.test_result','redvault_bank_filter_unconfigured');
RESET ROLE;
UPDATE private.uba_redvault_runtime
SET paystack_bank_code = '033', paystack_verified_issuer_name = 'UBA TEST BANK', paystack_verification_domain = 'test';
CREATE TABLE public.test_attempt AS SELECT attempt.attempt_id, attempt.reference, attempt.amount_kobo, attempt.currency, attempt.quote_payload_hash, attempt.state, attempt.bank_code FROM public.test_result CROSS JOIN LATERAL public.reserve_storefront_redvault_payment_attempt(id) AS attempt WITH NO DATA;
GRANT INSERT, SELECT ON public.test_attempt TO authenticated;
SET ROLE authenticated;
INSERT INTO public.test_attempt SELECT attempt.attempt_id, attempt.reference, attempt.amount_kobo, attempt.currency, attempt.quote_payload_hash, attempt.state, attempt.bank_code FROM public.test_result CROSS JOIN LATERAL public.reserve_storefront_redvault_payment_attempt(id) AS attempt;
SELECT public.reserve_storefront_redvault_payment_attempt(id) FROM public.test_result;
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM private.uba_redvault_payment_attempts) <> 1 THEN RAISE EXCEPTION 'attempt retry duplicated'; END IF; END $$;

SELECT public.test_expect_error(
  'UPDATE public.orders SET payment_status=''paid'' WHERE id = (SELECT order_id FROM private.uba_redvault_payment_attempts LIMIT 1)',
  'redvault_paid_transition_requires_approved_attempt'
);
UPDATE private.uba_redvault_payment_attempts SET state = 'captured_held';
SELECT public.test_expect_error(
  'UPDATE public.orders SET payment_status=''paid'' WHERE id = (SELECT order_id FROM private.uba_redvault_payment_attempts LIMIT 1)',
  'redvault_paid_transition_requires_approved_attempt'
);
SET ROLE authenticated;
SELECT public.test_expect_error(
  'INSERT INTO private.uba_redvault_refunds(attempt_id,idempotency_key,amount_kobo,state) SELECT id,''refund-1'',100,''requested'' FROM private.uba_redvault_payment_attempts LIMIT 1',
  'permission denied'
);
RESET ROLE;
