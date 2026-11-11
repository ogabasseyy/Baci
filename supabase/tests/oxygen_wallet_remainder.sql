-- Real deployed Oxygen function chain, synthetic identities and no provider I/O.
CREATE FUNCTION public.test_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',message; END IF; END $$;
CREATE FUNCTION public.test_reject(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF strpos(SQLERRM,expected)>0 THEN RETURN; END IF;
  RAISE EXCEPTION 'Expected %, got %',expected,SQLERRM;
 END;
 RAISE EXCEPTION 'Expected rejection: %',expected;
END $$;
INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000003');
INSERT INTO public.merchants(id) VALUES ('00000000-0000-4000-8000-000000000002');
INSERT INTO public.customers(id,merchant_id,user_id) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.partner_workers VALUES ('synthetic-partner','00000000-0000-4000-8000-000000000004');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,environment,enabled)
 VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','synthetic-partner','staging',true);
INSERT INTO public.orders(id,merchant_id,customer_id,total,currency,payment_method)
 SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',50000,'NGN','oxygen' FROM generate_series(10,19) n;
-- This insert fails before the fix: Oxygen originally forbade every wallet debit.
INSERT INTO public.customer_wallet_transactions(source_id,source_type,type,amount,customer_id,merchant_id)
 SELECT id,'order_redemption','redemption',20000,customer_id,merchant_id FROM public.orders;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
-- Verify the ordinary authenticated public boundary, including idempotent projection.
SET ROLE authenticated;
SELECT public.record_order_store_credit('00000000-0000-4000-8000-000000000010');
SELECT public.record_order_store_credit('00000000-0000-4000-8000-000000000010');
SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000010');
SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000010');
RESET ROLE;
SELECT public.test_assert((SELECT gross_amount=50000 AND wallet_amount=20000 AND financed_amount=30000 FROM oxygen_private.funding_snapshots WHERE order_id='00000000-0000-4000-8000-000000000010'),'immutable gross/wallet/net admission');
SELECT public.test_reject($q$UPDATE public.orders SET total=60000 WHERE id='00000000-0000-4000-8000-000000000010'$q$,'oxygen_funding_snapshot_changed');
SELECT public.test_reject($q$UPDATE public.orders SET wallet_amount_used=0 WHERE id='00000000-0000-4000-8000-000000000010'$q$,'oxygen_funding_snapshot_changed');
SELECT public.test_reject($q$UPDATE public.orders SET amount_paid=0 WHERE id='00000000-0000-4000-8000-000000000010'$q$,'oxygen_funding_snapshot_changed');
SELECT public.test_reject($q$DELETE FROM public.customer_wallet_transactions WHERE source_id='00000000-0000-4000-8000-000000000010'$q$,'oxygen_local_credit_in_use');
SELECT public.test_reject($q$UPDATE public.customer_wallet_transactions SET customer_id=gen_random_uuid() WHERE source_id='00000000-0000-4000-8000-000000000010'$q$,'oxygen_local_credit_in_use');
SELECT public.test_reject($q$UPDATE oxygen_private.funding_snapshots SET financed_amount=30001 WHERE order_id='00000000-0000-4000-8000-000000000010'$q$,'oxygen_funding_snapshot_immutable');
-- Admission rejects unprojected, foreign, refunded, savings and fully funded invoices.
SELECT public.test_reject($q$SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000011')$q$,'oxygen_local_credit_in_use');
UPDATE public.orders SET wallet_amount_used=20000,amount_paid=20000 WHERE id IN ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000014');
UPDATE public.customer_wallet_transactions SET customer_id=gen_random_uuid() WHERE source_id='00000000-0000-4000-8000-000000000012';
SELECT public.test_reject($q$SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000012')$q$,'oxygen_local_credit_in_use');
INSERT INTO public.customer_wallet_transactions(source_id,source_type,type,amount) VALUES('00000000-0000-4000-8000-000000000013','order_refund','refund',20000);
SELECT public.test_reject($q$SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000013')$q$,'oxygen_local_credit_in_use');
SELECT public.test_reject($q$INSERT INTO public.customer_savings_redemptions(order_id,amount) VALUES('00000000-0000-4000-8000-000000000014',1000)$q$,'oxygen_local_credit_in_use');
UPDATE public.orders SET wallet_amount_used=50000,amount_paid=50000 WHERE id='00000000-0000-4000-8000-000000000015';
UPDATE public.customer_wallet_transactions SET amount=50000 WHERE source_id='00000000-0000-4000-8000-000000000015';
SELECT public.test_reject($q$SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000015')$q$,'Order unavailable');

DO $$
DECLARE w uuid; cmd uuid; result jsonb; state jsonb; booking uuid:='10000000-0000-4000-8000-000000000001'; activation jsonb;
BEGIN
 SELECT id INTO w FROM public.oxygen_workflows WHERE order_id='00000000-0000-4000-8000-000000000010';
 result:=public.oxygen_runtime('enqueue',w,jsonb_build_object('version',0,'idempotencyKey','10000000-0000-4000-8000-000000000002','command',jsonb_build_object('action','book','equityPercentage',25,'tenure',1)));
 cmd:=(result->>'commandId')::uuid;
 PERFORM public.test_assert(public.oxygen_runtime('enqueue',w,jsonb_build_object('version',0,'idempotencyKey','10000000-0000-4000-8000-000000000002','command',jsonb_build_object('action','book','equityPercentage',25,'tenure',1)))=result,'enqueue idempotency');
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
 result:=public.oxygen_runtime('claim',cmd,jsonb_build_object('commandId',cmd));
 PERFORM public.test_assert((result->'context'->>'productAmount')::numeric=30000,'worker books the net invoice');
 state:=jsonb_build_object('applicationReference','10000000-0000-4000-8000-000000000003','bookingReference',booking,'booking',jsonb_build_object('loan_reference',booking,'status','BOOKED','product_amount',50000,'equity_percentage',25,'loan_tenure',1,'total_charges',100),'schedule',jsonb_build_array(jsonb_build_object('amount',100)));
 PERFORM public.test_reject(format('SELECT public.oxygen_runtime(''finish'',%L,%L::jsonb)',cmd,jsonb_build_object('commandId',cmd,'outcome','succeeded','stage','booked','state',state)),'Order amount changed');
 state:=jsonb_set(state,'{booking,product_amount}','30000');
 PERFORM public.oxygen_runtime('finish',cmd,jsonb_build_object('commandId',cmd,'outcome','succeeded','stage','booked','state',state));
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
 result:=public.oxygen_saved_plans(w);
 PERFORM public.test_assert(jsonb_array_length(result->'plans')=1 AND (result->'plans'->0->>'productAmount')::numeric=30000,'saved plans use net basis');
 result:=public.oxygen_accept_saved_plan(w,booking,1);
 PERFORM public.test_assert(result->>'bookingReference'=booking::text,'cached plan acceptance uses net basis');
 -- Activation uses the same net amount and leaves merchant payment unconfirmed.
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
 UPDATE oxygen_private.provider_states ps SET state=jsonb_set(ps.state,'{booking,status}','"APPROVED"') WHERE workflow_id=w;
 UPDATE public.oxygen_workflows SET stage='ready_for_activation' WHERE id=w;
 INSERT INTO oxygen_private.payment_recovery(workflow_id,booking_reference,idempotency_key,action,status,expected_version,result,completed_at)
 VALUES(w,booking,gen_random_uuid(),'check_status','succeeded',1,'{"paymentComplete":true,"setupComplete":true}',clock_timestamp());
 INSERT INTO oxygen_private.general_activation_policy(environment,enabled) VALUES('staging',true) ON CONFLICT(environment) DO UPDATE SET enabled=true;
 activation:=public.oxygen_general_activation('claim',w);
 PERFORM public.test_assert((SELECT amount=30000 FROM oxygen_private.general_activations WHERE workflow_id=w),'activation records net basis');
 PERFORM public.oxygen_general_activation('finish',w,jsonb_build_object('attemptId',activation->>'attemptId','reference',booking,'status','activated','ciphertext','v1.abcdefghijklmnop.abcdefghijklmnop.abcdefghijklmnop'));
 result:=public.oxygen_general_activation('reconcile',w);
 PERFORM public.test_assert(result->>'orderConfirmed'='true','net activation reconciles');
 PERFORM public.test_assert((SELECT total=50000 AND amount_paid=20000 AND payment_status='unpaid' FROM public.orders WHERE id='00000000-0000-4000-8000-000000000010'),'activation never claims merchant settlement');
END $$;
SELECT public.test_reject($q$UPDATE public.customer_wallet_transactions SET status='failed' WHERE source_id='00000000-0000-4000-8000-000000000010'$q$,'oxygen_local_credit_in_use');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
SELECT public.record_order_store_credit('00000000-0000-4000-8000-000000000016');
SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000016');
-- Simulate legacy out-of-band conflicting evidence; mutation must fail while
-- customer status and provider status checks remain available for investigation.
ALTER TABLE public.orders DISABLE TRIGGER oxygen_order_wallet_credit_guard;
UPDATE public.orders SET amount_paid=19999 WHERE id='00000000-0000-4000-8000-000000000016';
ALTER TABLE public.orders ENABLE TRIGGER oxygen_order_wallet_credit_guard;
DO $$
DECLARE w uuid; result jsonb; cmd uuid;
BEGIN
 SELECT id INTO w FROM public.oxygen_workflows WHERE order_id='00000000-0000-4000-8000-000000000016';
 result:=public.oxygen_runtime('status',w);
 PERFORM public.test_assert(result->>'workflowId'=w::text,'legacy conflict status remains readable');
 PERFORM public.test_reject(format('SELECT public.oxygen_runtime(''enqueue'',%L,%L::jsonb)',w,'{"version":0,"idempotencyKey":"10000000-0000-4000-8000-000000000009","command":{"action":"book"}}'),'oxygen_local_credit_in_use');
 result:=public.oxygen_runtime('enqueue',w,'{"version":0,"idempotencyKey":"10000000-0000-4000-8000-000000000010","command":{"action":"refresh_kyc"}}');
 cmd:=(result->>'commandId')::uuid;
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
 result:=public.oxygen_runtime('claim',cmd,jsonb_build_object('commandId',cmd));
 PERFORM public.test_assert(result->'command'->>'action'='refresh_kyc','legacy conflict read-only recovery can dispatch');
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
UPDATE public.customer_wallet_transactions SET status='pending' WHERE source_id='00000000-0000-4000-8000-000000000018';
UPDATE public.orders SET amount_paid=20000,wallet_amount_used=20000 WHERE id='00000000-0000-4000-8000-000000000018';
SELECT public.test_reject($q$SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000018')$q$,'oxygen_local_credit_in_use');
SELECT public.record_order_store_credit('00000000-0000-4000-8000-000000000017');
-- Originally non-Oxygen rails and production admission retain their fences.
INSERT INTO public.orders(id,merchant_id,customer_id,total,currency,payment_method)
 VALUES('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',50000,'NGN','card');
SELECT public.test_reject($q$UPDATE public.orders SET payment_method='oxygen' WHERE id='00000000-0000-4000-8000-000000000021'$q$,'oxygen_previous_payment_unresolved');
SELECT public.record_order_store_credit('00000000-0000-4000-8000-000000000019');
UPDATE oxygen_private.runtime_bindings SET environment='production';
SELECT public.test_reject($q$SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000019')$q$,'Provider connection unavailable');
UPDATE oxygen_private.runtime_bindings SET environment='staging';
-- Exercise the actual one-use staging trial and its canonical reconciliation.
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id,environment,stage)
 VALUES('52ab6696-762b-4e9f-8f99-a9d926a29b2c','00000000-0000-4000-8000-000000000019','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','staging','ready_for_activation');
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('52ab6696-762b-4e9f-8f99-a9d926a29b2c','{"applicationReference":"20000000-0000-4000-8000-000000000001","bookingReference":"20000000-0000-4000-8000-000000000002","booking":{"loan_reference":"20000000-0000-4000-8000-000000000002","product_amount":30000,"status":"APPROVED"},"paymentComplete":true,"setupComplete":true}');
INSERT INTO oxygen_private.activation_trials(workflow_id,booking_reference) VALUES('52ab6696-762b-4e9f-8f99-a9d926a29b2c','20000000-0000-4000-8000-000000000002');
SELECT public.oxygen_activation_trial('enqueue','{"workflowId":"52ab6696-762b-4e9f-8f99-a9d926a29b2c"}');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
SELECT public.oxygen_activation_trial('claim','{"workflowId":"52ab6696-762b-4e9f-8f99-a9d926a29b2c"}');
SELECT public.oxygen_activation_trial('finish','{"workflowId":"52ab6696-762b-4e9f-8f99-a9d926a29b2c","status":"activated","result":{"loan_reference":"20000000-0000-4000-8000-000000000002","status":"ACTIVATED","product_amount":30000}}');
SELECT public.test_assert((public.oxygen_reconcile_activation('52ab6696-762b-4e9f-8f99-a9d926a29b2c','20000000-0000-4000-8000-000000000002')->>'orderConfirmed')::boolean,'canonical trial net reconciliation');
SELECT public.test_assert((SELECT total=50000 AND amount_paid=20000 AND payment_status='unpaid' FROM public.orders WHERE id='00000000-0000-4000-8000-000000000019'),'trial activation does not mark settlement');
-- Retain completed activation evidence when later financial conflict needs review.
ALTER TABLE public.orders DISABLE TRIGGER oxygen_order_wallet_credit_guard;
UPDATE public.orders SET amount_paid=19999 WHERE id='00000000-0000-4000-8000-000000000010';
ALTER TABLE public.orders ENABLE TRIGGER oxygen_order_wallet_credit_guard;
SELECT public.test_assert((public.oxygen_general_activation('reconcile',(SELECT id FROM public.oxygen_workflows WHERE order_id='00000000-0000-4000-8000-000000000010'))->>'reviewRequired')::boolean,'activation funding conflict becomes review without declaring order confirmed');
SELECT public.test_assert((SELECT status='activated' AND ciphertext IS NOT NULL FROM oxygen_private.general_activations WHERE order_id='00000000-0000-4000-8000-000000000010'),'conflict preserves activation response evidence');
UPDATE oxygen_private.activation_trials SET result=jsonb_set(result,'{product_amount}','50000') WHERE workflow_id='52ab6696-762b-4e9f-8f99-a9d926a29b2c';
SELECT public.test_reject($q$SELECT public.oxygen_reconcile_activation('52ab6696-762b-4e9f-8f99-a9d926a29b2c','20000000-0000-4000-8000-000000000002')$q$,'Activation binding changed');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
INSERT INTO public.transactions(order_id,transaction_type) VALUES('00000000-0000-4000-8000-000000000014','payment');
SELECT public.test_reject($q$SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000014')$q$,'oxygen_gateway_payment_in_use');
-- Satisfy the independent credit checks before testing the recorded-gateway
-- method guard, including the full-replay case with a failed card payment.
INSERT INTO public.orders(id,merchant_id,customer_id,total,currency,payment_method)
 VALUES('00000000-0000-4000-8000-000000000027','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',50000,'NGN','paystack');
INSERT INTO public.transactions(order_id,transaction_type,status)
 VALUES('00000000-0000-4000-8000-000000000027','payment','failed');
SELECT public.test_reject($q$UPDATE public.orders SET payment_method='oxygen' WHERE id='00000000-0000-4000-8000-000000000027'$q$,'oxygen_gateway_payment_in_use');
INSERT INTO public.orders(id,merchant_id,customer_id,total,currency,payment_method)
 VALUES('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',50000,'NGN','oxygen');
SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000022');
SELECT public.test_assert((SELECT gross_amount=50000 AND wallet_amount=0 AND financed_amount=50000 FROM oxygen_private.funding_snapshots WHERE order_id='00000000-0000-4000-8000-000000000022'),'uncredited invoice preserves full financing');
-- Preserve the existing safe method-only exit and subsequent gateway settlement.
UPDATE public.orders SET payment_method='card' WHERE id='00000000-0000-4000-8000-000000000022';
UPDATE public.orders SET amount_paid=50000,payment_status='paid' WHERE id='00000000-0000-4000-8000-000000000022';
SELECT public.test_assert((SELECT payment_status='paid' FROM public.orders WHERE id='00000000-0000-4000-8000-000000000022'),'safe exit keeps later non-Oxygen settlement usable');

-- An authenticated manual settlement on an existing Oxygen order preserves the
-- original financing basis and keeps new Oxygen commands fenced.
INSERT INTO public.orders(id,merchant_id,customer_id,total,currency,payment_method)
 VALUES('00000000-0000-4000-8000-000000000026','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',50000,'NGN','oxygen');
SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000026');
SELECT public.test_reject($q$UPDATE public.orders SET amount_paid=1000 WHERE id='00000000-0000-4000-8000-000000000026'$q$,'oxygen_funding_snapshot_changed');
UPDATE public.merchants SET user_id='00000000-0000-4000-8000-000000000005' WHERE id='00000000-0000-4000-8000-000000000002';
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',false);
SET ROLE authenticated;
SELECT public.record_manual_order_payment(
 '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000026',
 1000,'NGN',NULL,'Test manual deposit','{}','oxygen-manual-test'
);
SELECT public.record_manual_order_payment(
 '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000026',
 1000,'NGN',NULL,'Test manual deposit','{}','oxygen-manual-test'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
SELECT public.test_assert((SELECT amount_paid=1000 AND payment_status='partially_paid' FROM public.orders WHERE id='00000000-0000-4000-8000-000000000026'),'manual deposit is applied exactly once');
SELECT public.test_assert((SELECT count(*)=1 FROM public.transactions WHERE order_id='00000000-0000-4000-8000-000000000026'),'manual replay does not duplicate its ledger row');
SELECT public.test_assert(oxygen_private.financed_amount('00000000-0000-4000-8000-000000000026')=50000,'manual recording preserves admitted basis');
SELECT public.test_reject($q$SELECT oxygen_private.assert_no_recorded_gateway_payment('00000000-0000-4000-8000-000000000026')$q$,'oxygen_gateway_payment_in_use');
SELECT public.test_reject($q$UPDATE public.orders SET amount_paid=2000 WHERE id='00000000-0000-4000-8000-000000000026'$q$,'oxygen_funding_snapshot_changed');

-- The actual reversal RPC must preserve one admitted debit until a provably
-- safe, authenticated cancellation; an application-only draft may exit.
INSERT INTO public.customer_wallets(id,customer_id,merchant_id,available_balance,total_redeemed)
 VALUES('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',0,40000);
INSERT INTO public.orders(id,merchant_id,customer_id,total,currency,payment_method)
 SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',50000,'NGN','oxygen' FROM generate_series(23,24) n;
INSERT INTO public.customer_wallet_transactions(wallet_id,source_id,source_type,type,amount,customer_id,merchant_id)
 SELECT '30000000-0000-4000-8000-000000000001',id,'order_redemption','redemption',20000,customer_id,merchant_id FROM public.orders WHERE id IN ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000024');
SELECT public.record_order_store_credit('00000000-0000-4000-8000-000000000023');
SELECT public.record_order_store_credit('00000000-0000-4000-8000-000000000024');
SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000023');
SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000024');
SELECT public.test_reject($q$SELECT public.reverse_wallet_redemption('00000000-0000-4000-8000-000000000023')$q$,'oxygen_local_credit_in_use');
UPDATE public.orders SET payment_method='card' WHERE id IN ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000024');
INSERT INTO public.transactions(order_id,merchant_id,transaction_type,gateway,status,amount,currency)
 VALUES('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000002','payment','paystack','completed',30000,'NGN');
UPDATE public.orders SET amount_paid=50000,payment_status='paid' WHERE id='00000000-0000-4000-8000-000000000023';
UPDATE public.orders SET shipping_status='cancelled',cancelled_at=now() WHERE id IN ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000024');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false);
SELECT public.test_reject($q$SELECT public.reverse_wallet_redemption('00000000-0000-4000-8000-000000000023')$q$,'oxygen_local_credit_in_use');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
SELECT public.test_assert((SELECT success FROM public.reverse_wallet_redemption('00000000-0000-4000-8000-000000000023')),'safe cancelled wallet debit restored');
SELECT public.test_assert((SELECT NOT success FROM public.reverse_wallet_redemption('00000000-0000-4000-8000-000000000023')),'reversal retry cannot double credit');
SELECT public.test_assert((SELECT available_balance=20000 FROM public.customer_wallets WHERE id='30000000-0000-4000-8000-000000000001'),'wallet restored exactly once');
SELECT public.test_assert((SELECT gross_amount=50000 AND wallet_amount=20000 AND financed_amount=30000 FROM oxygen_private.funding_snapshots WHERE order_id='00000000-0000-4000-8000-000000000023'),'refund preserves historical invoice basis');
-- Explicit Oxygen payment evidence remains blocking after a method switch.
INSERT INTO public.transactions(order_id,merchant_id,transaction_type,gateway,status,amount,currency)
 VALUES('00000000-0000-4000-8000-000000000024','00000000-0000-4000-8000-000000000002','payment','oxygen','completed',30000,'NGN');
SELECT public.test_reject($q$SELECT public.reverse_wallet_redemption('00000000-0000-4000-8000-000000000024')$q$,'oxygen_local_credit_in_use');
DELETE FROM public.transactions WHERE order_id='00000000-0000-4000-8000-000000000024';
-- A legacy order_refund credit has the same safe terminal proof and debit binding.
INSERT INTO public.customer_wallet_transactions(wallet_id,source_id,source_type,type,amount,balance_after,customer_id,merchant_id)
 VALUES('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000024','order_refund','refund',20000,40000,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
SELECT public.test_reject($q$SELECT public.reverse_wallet_redemption('00000000-0000-4000-8000-000000000024')$q$,'oxygen_local_credit_in_use');
-- A changed rail plus cancellation is insufficient if durable command evidence
-- still records uncertainty. No provider call is made by this fixture.
INSERT INTO public.orders(id,merchant_id,customer_id,total,currency,payment_method)
 VALUES('00000000-0000-4000-8000-000000000025','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',50000,'NGN','oxygen');
INSERT INTO public.customer_wallet_transactions(wallet_id,source_id,source_type,type,amount,customer_id,merchant_id)
 SELECT '30000000-0000-4000-8000-000000000001',id,'order_redemption','redemption',20000,customer_id,merchant_id FROM public.orders WHERE id='00000000-0000-4000-8000-000000000025';
SELECT public.record_order_store_credit('00000000-0000-4000-8000-000000000025');
SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000025');
UPDATE public.orders SET payment_method='card',shipping_status='cancelled',cancelled_at=now() WHERE id='00000000-0000-4000-8000-000000000025';
INSERT INTO oxygen_private.commands(workflow_id,idempotency_key,expected_version,channel,command,status)
 SELECT id,gen_random_uuid(),0,'web','{"action":"book"}'::jsonb,'indeterminate' FROM public.oxygen_workflows WHERE order_id='00000000-0000-4000-8000-000000000025';
SELECT public.test_reject($q$SELECT public.reverse_wallet_redemption('00000000-0000-4000-8000-000000000025')$q$,'oxygen_local_credit_in_use');
SELECT public.test_assert((SELECT available_balance=20000 FROM public.customer_wallets WHERE id='30000000-0000-4000-8000-000000000001'),'uncertain obligation cannot release wallet funding');
