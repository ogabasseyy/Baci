-- Rollback-only regression after the general-activation amount migration.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES('ba100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oxygen-amount@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000001',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES('ba100000-0000-4000-8000-000000000002','ba100000-0000-4000-8000-000000000001','oxygen-amount@example.test','Amount fixture','oxygen-amount-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES('ba100000-0000-4000-8000-000000000003','ba100000-0000-4000-8000-000000000002','ba100000-0000-4000-8000-000000000001','Amount','Fixture','oxygen-amount@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES('ba100000-0000-4000-8000-000000000004','ba100000-0000-4000-8000-000000000002','ba100000-0000-4000-8000-000000000003','OXYGEN-AMOUNT-FIXTURE',5000,'NGN','unpaid','oxygen');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES('ba100000-0000-4000-8000-000000000005','ba100000-0000-4000-8000-000000000004','ba100000-0000-4000-8000-000000000002','ba100000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id)
VALUES('oxygen-amount-fixture','ba100000-0000-4000-8000-000000000001');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled)
VALUES('ba100000-0000-4000-8000-000000000002','ba100000-0000-4000-8000-000000000001','oxygen-amount-fixture',true);
INSERT INTO oxygen_private.provider_states(workflow_id,state)
VALUES('ba100000-0000-4000-8000-000000000005','{}');
DO $$
DECLARE w public.oxygen_workflows%ROWTYPE; b oxygen_private.runtime_bindings%ROWTYPE;
 app uuid:='ba000000-0000-4000-8000-000000000002';
 ref uuid:='ba000000-0000-4000-8000-000000000001';
 invalid jsonb; evidence_id uuid; claim jsonb; rejected boolean;
BEGIN
 SELECT w1.* INTO w FROM public.oxygen_workflows w1
 JOIN oxygen_private.runtime_bindings b1 ON b1.merchant_id=w1.merchant_id
 JOIN oxygen_private.provider_states s ON s.workflow_id=w1.id
 JOIN public.orders o ON o.id=w1.order_id AND o.customer_id=w1.customer_id AND o.merchant_id=w1.merchant_id
 WHERE w1.id='ba100000-0000-4000-8000-000000000005'
 AND NOT EXISTS(SELECT 1 FROM oxygen_private.general_activations a WHERE a.workflow_id=w1.id)
 AND NOT EXISTS(SELECT 1 FROM oxygen_private.activation_trials t WHERE t.workflow_id=w1.id)
 AND NOT EXISTS(SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w1.id AND c.status IN ('queued','executing','indeterminate'))
 AND NOT EXISTS(SELECT 1 FROM oxygen_private.payment_recovery r WHERE r.workflow_id=w1.id AND r.status IN ('queued','executing'))
 ORDER BY w1.id LIMIT 1 FOR UPDATE OF w1;
 IF NOT FOUND THEN RAISE EXCEPTION 'No rollback fixture'; END IF;
 SELECT * INTO b FROM oxygen_private.runtime_bindings WHERE merchant_id=w.merchant_id FOR UPDATE;
 UPDATE oxygen_private.runtime_bindings SET enabled=true,environment=w.environment WHERE merchant_id=w.merchant_id;
 INSERT INTO oxygen_private.general_activation_policy(environment,enabled) VALUES(w.environment,true)
 ON CONFLICT(environment) DO UPDATE SET enabled=true;
 UPDATE public.orders SET payment_method='oxygen',payment_status='unpaid',cancelled_at=NULL,currency='NGN' WHERE id=w.order_id;
 UPDATE public.oxygen_workflows SET stage='payment_required' WHERE id=w.id;
 PERFORM set_config('request.jwt.claim.sub',b.worker_user_id::text,true);
 INSERT INTO oxygen_private.payment_recovery(workflow_id,booking_reference,expected_version,idempotency_key,action,status,result,completed_at)
 VALUES(w.id,ref,w.version,gen_random_uuid(),'check_status','succeeded','{"paymentComplete":true,"setupComplete":true}',clock_timestamp());
 FOREACH invalid IN ARRAY ARRAY['"bad"'::jsonb,'"1e200000"'::jsonb,'{}'::jsonb,'null'::jsonb] LOOP
  UPDATE oxygen_private.provider_states SET state=jsonb_build_object('applicationReference',app,'bookingReference',ref,
   'booking',jsonb_build_object('loan_reference',ref,'status','APPROVED','product_amount',invalid)) WHERE workflow_id=w.id;
  rejected:=false;
  BEGIN PERFORM public.oxygen_general_activation('claim',w.id,'{}'); EXCEPTION WHEN serialization_failure THEN rejected:=true; END;
  IF NOT rejected OR EXISTS(SELECT 1 FROM oxygen_private.general_activations WHERE workflow_id=w.id) THEN
   RAISE EXCEPTION 'Malformed amount did not safely reject claim';
  END IF;
 END LOOP;
 UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{booking,product_amount}',to_jsonb((SELECT total::text FROM public.orders WHERE id=w.order_id))) WHERE workflow_id=w.id;
 claim:=public.oxygen_general_activation('claim',w.id,'{}');
 evidence_id:=(claim->>'attemptId')::uuid;
 PERFORM public.oxygen_general_activation('finish',w.id,jsonb_build_object('attemptId',evidence_id,'reference',ref,'status','activated',
  'ciphertext','v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',50)));
 UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{booking,product_amount}','"bad"'::jsonb) WHERE workflow_id=w.id;
 rejected:=public.oxygen_general_activation('reconcile',w.id,'{}')->>'reviewRequired'='true';
 IF NOT rejected OR NOT EXISTS(SELECT 1 FROM oxygen_private.general_activations WHERE id=evidence_id AND status='activated' AND ciphertext IS NOT NULL)
 OR (SELECT stage FROM public.oxygen_workflows WHERE id=w.id)='activated' THEN
  RAISE EXCEPTION 'Malformed amount lost activation evidence or projected';
 END IF;
 UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{booking,product_amount}',to_jsonb((SELECT total FROM public.orders WHERE id=w.order_id))) WHERE workflow_id=w.id;
 UPDATE oxygen_private.general_activation_reconcile_conflicts SET resolved_at=clock_timestamp() WHERE workflow_id=w.id;
 IF public.oxygen_general_activation('reconcile',w.id,'{}')->>'orderConfirmed' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Valid evidence did not reconcile';
 END IF;
END $$;
ROLLBACK;
