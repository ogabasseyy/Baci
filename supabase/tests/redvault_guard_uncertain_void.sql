-- No provider call is made. Fixture writes and all RPC calls are rolled back.
BEGIN;
SET LOCAL session_replication_role='replica';
INSERT INTO public.orders(id,merchant_id,order_number,total,payment_method,payment_status)
VALUES ('d5000000-0000-4000-8000-000000000001','6b5cb8a4-5575-456c-b936-8cdfae30db74','RV-VOID-GUARD',100,'uba_redvault','unpaid');
INSERT INTO private.uba_redvault_applications(id,order_id,discount_code_id,merchant_id,quote_version_id,quote_payload_hash,quote_payload,customer_email,checkout_key,request_hash,discount_kobo,eligible_subtotal_kobo,status,user_id)
VALUES ('d5000000-0000-4000-8000-000000000002','d5000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000003','6b5cb8a4-5575-456c-b936-8cdfae30db74','d5000000-0000-4000-8000-000000000004',repeat('a',64),'{}','voidguard@example.test','RV-VOID','RV-VOID',100,10000,'pending',NULL);
INSERT INTO private.uba_redvault_payment_attempts(id,application_id,order_id,merchant_id,reference,quote_payload_hash,amount_kobo,currency,state,accepted_filter_policy,accepted_filter_policy_hash,paystack_subaccount_code,platform_fee_kobo,authorization_url)
SELECT id,'d5000000-0000-4000-8000-000000000002','d5000000-0000-4000-8000-000000000001','6b5cb8a4-5575-456c-b936-8cdfae30db74',ref,repeat('a',64),10000,'NGN',state,p,encode(extensions.digest(p::text,'sha256'),'hex'),'ACCT_fixture',200,NULL
FROM (VALUES ('d5000000-0000-4000-8000-000000000005'::uuid,'RV-VOID-1','initializing')) attempts(id,ref,state)
CROSS JOIN (SELECT jsonb_build_object('bankCode','058','issuerName','GTBank','verificationDomain','test','cardBrands',jsonb_build_array('verve','visa','mastercard')) p) fixture;
SET LOCAL session_replication_role='origin';
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74","storefront_redvault_customer_email":"voidguard@example.test"}',true);
DO $$ DECLARE v_row record; BEGIN
 BEGIN
  PERFORM public.reconcile_storefront_redvault_payment_attempt_initialization('d5000000-0000-4000-8000-000000000005','void',NULL);
  RAISE EXCEPTION 'initializing attempt was voided';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'redvault_retirement_unconfirmed' THEN RAISE; END IF; END;
 SELECT * INTO v_row FROM public.reconcile_storefront_redvault_payment_attempt_initialization('d5000000-0000-4000-8000-000000000005','indeterminate',NULL);
 IF v_row.state<>'indeterminate' THEN RAISE EXCEPTION 'indeterminate recovery rejected'; END IF;
 BEGIN
  PERFORM public.reconcile_storefront_redvault_payment_attempt_initialization('d5000000-0000-4000-8000-000000000005','void',NULL);
  RAISE EXCEPTION 'indeterminate attempt was voided';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'redvault_retirement_unconfirmed' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','d5000000-0000-4000-8000-000000000009',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.reconcile_storefront_redvault_payment_attempt_initialization('d5000000-0000-4000-8000-000000000005','void',NULL);
  RAISE EXCEPTION 'foreign customer reached recovery';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'redvault_customer_context_required' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.reconcile_storefront_redvault_payment_attempt_initialization('d5000000-0000-4000-8000-000000000005','void',NULL);
  RAISE EXCEPTION 'service voided uncertain attempt';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'redvault_retirement_unconfirmed' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$ DECLARE v_row record; BEGIN
 SELECT * INTO v_row FROM public.reconcile_storefront_redvault_payment_attempt_initialization('d5000000-0000-4000-8000-000000000005','initialized','https://checkout.paystack.com/verified');
 IF v_row.state<>'initialized' OR v_row.authorization_url<>'https://checkout.paystack.com/verified' THEN RAISE EXCEPTION 'initialized recovery rejected'; END IF;
END $$;
ROLLBACK;
