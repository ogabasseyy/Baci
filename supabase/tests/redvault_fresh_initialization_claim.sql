-- Run after the fresh-claim migration in an isolated rollback transaction.
BEGIN;
SET LOCAL session_replication_role='replica';
INSERT INTO public.merchants(id,email,business_name) VALUES('6b5cb8a4-5575-456c-b936-8cdfae30db74','rv-fresh@example.test','Fresh claim fixture') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.orders(id,merchant_id,order_number,total,payment_method,payment_status)
VALUES ('d4000000-0000-4000-8000-000000000001','6b5cb8a4-5575-456c-b936-8cdfae30db74','RV-FRESH-CLAIM',100,'uba_redvault','unpaid');
INSERT INTO private.uba_redvault_applications(id,order_id,discount_code_id,merchant_id,quote_version_id,quote_payload_hash,quote_payload,customer_email,checkout_key,request_hash,discount_kobo,eligible_subtotal_kobo,status,user_id)
VALUES ('d4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000003','6b5cb8a4-5575-456c-b936-8cdfae30db74','d4000000-0000-4000-8000-000000000004',repeat('a',64),'{}','fresh@example.test','RV-FRESH','RV-FRESH',100,10000,'pending',NULL);
INSERT INTO private.uba_redvault_payment_attempts(id,application_id,order_id,merchant_id,reference,quote_payload_hash,amount_kobo,currency,state,accepted_filter_policy,accepted_filter_policy_hash,paystack_subaccount_code,platform_fee_kobo,authorization_url)
SELECT 'd4000000-0000-4000-8000-000000000005','d4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000001','6b5cb8a4-5575-456c-b936-8cdfae30db74','RV-FRESH-REF',repeat('a',64),10000,'NGN','created',p,encode(extensions.digest(p::text,'sha256'),'hex'),'ACCT_fixture',200,NULL
FROM (SELECT jsonb_build_object('bankCode','058','issuerName','GTBank','verificationDomain','test','cardBrands',jsonb_build_array('verve','visa','mastercard')) p) fixture;
SET LOCAL session_replication_role='origin';
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74","storefront_redvault_customer_email":"fresh@example.test"}',true);
DO $$ DECLARE result record; BEGIN
 SELECT * INTO result FROM public.claim_storefront_redvault_payment_attempt_initialization_v4('d4000000-0000-4000-8000-000000000005');
 IF result.initialization_claimed IS DISTINCT FROM true OR result.initialization_fresh IS DISTINCT FROM true THEN RAISE EXCEPTION 'fresh claim rejected'; END IF;
END $$;
SET LOCAL session_replication_role='replica';
UPDATE private.uba_redvault_payment_attempts SET initialization_claimed_at=clock_timestamp()-interval '3 minutes' WHERE id='d4000000-0000-4000-8000-000000000005';
SET LOCAL session_replication_role='origin';
DO $$ DECLARE result record; before_claim timestamptz; BEGIN
 SELECT initialization_claimed_at INTO before_claim FROM private.uba_redvault_payment_attempts WHERE id='d4000000-0000-4000-8000-000000000005';
 SELECT * INTO result FROM public.claim_storefront_redvault_payment_attempt_initialization_v2('d4000000-0000-4000-8000-000000000005');
 IF result.initialization_claimed IS DISTINCT FROM false OR result.state IS DISTINCT FROM 'initializing' OR NOT EXISTS (
  SELECT 1 FROM private.uba_redvault_payment_attempts WHERE id='d4000000-0000-4000-8000-000000000005'
   AND state='initializing' AND initialization_claimed_at IS NOT DISTINCT FROM before_claim
 ) THEN RAISE EXCEPTION 'stale claim was reclaimed or changed'; END IF;
 SELECT * INTO result FROM public.claim_storefront_redvault_payment_attempt_initialization_v4('d4000000-0000-4000-8000-000000000005');
 IF result.initialization_claimed IS DISTINCT FROM false OR result.initialization_fresh IS DISTINCT FROM false THEN RAISE EXCEPTION 'stale v4 claim was reclaimed'; END IF;
 IF NOT has_function_privilege('authenticated','public.claim_storefront_redvault_payment_attempt_initialization_v4(uuid)','EXECUTE')
 OR has_function_privilege('anon','public.claim_storefront_redvault_payment_attempt_initialization_v4(uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.claim_storefront_redvault_payment_attempt_initialization_v4(uuid)','EXECUTE') THEN RAISE EXCEPTION 'fresh claim grant invalid'; END IF;
END $$;
SET LOCAL session_replication_role='replica';
UPDATE private.uba_redvault_payment_attempts SET initialization_claimed_at=NULL WHERE id='d4000000-0000-4000-8000-000000000005';
SET LOCAL session_replication_role='origin';
DO $$ DECLARE result record; BEGIN
 SELECT * INTO result FROM public.claim_storefront_redvault_payment_attempt_initialization_v4('d4000000-0000-4000-8000-000000000005');
 IF result.initialization_claimed IS DISTINCT FROM false OR result.initialization_fresh IS DISTINCT FROM false OR NOT EXISTS (
  SELECT 1 FROM private.uba_redvault_payment_attempts WHERE id='d4000000-0000-4000-8000-000000000005'
   AND state='initializing' AND initialization_claimed_at IS NULL
 ) THEN RAISE EXCEPTION 'NULL initialization lease was reclaimed or changed'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"00000000-0000-4000-8000-000000000009","storefront_redvault_customer_email":"fresh@example.test"}',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.claim_storefront_redvault_payment_attempt_initialization_v4('d4000000-0000-4000-8000-000000000005');
  RAISE EXCEPTION 'foreign merchant claimed attempt';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'redvault_customer_context_required' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
