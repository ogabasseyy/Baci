-- Run after the new migrations inside a transaction that is rolled back.
-- Existing rows are used only as rollback-only fixtures; no provider calls.
DO $$
DECLARE w public.oxygen_workflows%ROWTYPE; b oxygen_private.runtime_bindings%ROWTYPE;
 ref uuid := 'ba000000-0000-4000-8000-000000000001';
 app uuid := 'ba000000-0000-4000-8000-000000000002';
 claim jsonb; result jsonb; payment_id uuid; before_status text; expected_error boolean;
BEGIN
 SELECT w1.* INTO w FROM public.oxygen_workflows w1
 JOIN oxygen_private.runtime_bindings b1 ON b1.merchant_id=w1.merchant_id
 JOIN oxygen_private.provider_states s ON s.workflow_id=w1.id
 JOIN public.orders o ON o.id=w1.order_id AND o.customer_id=w1.customer_id AND o.merchant_id=w1.merchant_id
 WHERE NOT EXISTS(SELECT 1 FROM oxygen_private.activation_trials t WHERE t.workflow_id=w1.id)
 AND NOT EXISTS(SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w1.id AND c.status IN ('queued','executing','indeterminate'))
 AND NOT EXISTS(SELECT 1 FROM oxygen_private.payment_recovery r WHERE r.workflow_id=w1.id AND r.status IN ('queued','executing'))
 ORDER BY w1.id LIMIT 1 FOR UPDATE OF w1;
 IF NOT FOUND THEN RAISE EXCEPTION 'No rollback fixture'; END IF;
 SELECT * INTO b FROM oxygen_private.runtime_bindings WHERE merchant_id=w.merchant_id FOR UPDATE;
 UPDATE oxygen_private.runtime_bindings SET enabled=true,environment=w.environment WHERE merchant_id=w.merchant_id;
 UPDATE public.orders SET payment_method='oxygen',payment_status='unpaid',cancelled_at=NULL,currency='NGN' WHERE id=w.order_id;
 SELECT payment_status INTO before_status FROM public.orders WHERE id=w.order_id;
 UPDATE public.oxygen_workflows SET stage='payment_required' WHERE id=w.id;
 UPDATE oxygen_private.provider_states SET state=jsonb_build_object('applicationReference',app,'bookingReference',ref,'booking',jsonb_build_object('loan_reference',ref,'status','APPROVED','product_amount',(SELECT total FROM public.orders WHERE id=w.order_id))) WHERE workflow_id=w.id;
 PERFORM set_config('request.jwt.claim.sub',b.worker_user_id::text,true);
 expected_error:=false;
 BEGIN PERFORM public.oxygen_general_activation('claim',w.id,'{}'); EXCEPTION WHEN insufficient_privilege THEN expected_error:=true; END;
 IF NOT expected_error THEN RAISE EXCEPTION 'Default gate accepted'; END IF;
 INSERT INTO oxygen_private.general_activation_policy(environment,enabled) VALUES(w.environment,true);
 expected_error:=false;
 BEGIN PERFORM public.oxygen_general_activation('claim',w.id,'{}'); EXCEPTION WHEN serialization_failure THEN expected_error:=true; END;
 IF NOT expected_error THEN RAISE EXCEPTION 'Unpaid claim accepted'; END IF;
 INSERT INTO oxygen_private.payment_recovery(workflow_id,booking_reference,expected_version,idempotency_key,action,status,result,completed_at)
 VALUES(w.id,ref,w.version,gen_random_uuid(),'check_status','succeeded','{"paymentComplete":true,"setupComplete":false}',clock_timestamp()) RETURNING id INTO payment_id;
 expected_error:=false;
 BEGIN PERFORM public.oxygen_general_activation('claim',w.id,'{}'); EXCEPTION WHEN serialization_failure THEN expected_error:=true; END;
 IF NOT expected_error THEN RAISE EXCEPTION 'Incomplete setup accepted'; END IF;
 UPDATE oxygen_private.payment_recovery SET result='{"paymentComplete":true,"setupComplete":true}',completed_at=clock_timestamp()-interval '11 minutes' WHERE id=payment_id;
 expected_error:=false;
 BEGIN PERFORM public.oxygen_general_activation('claim',w.id,'{}'); EXCEPTION WHEN serialization_failure THEN expected_error:=true; END;
 IF NOT expected_error THEN RAISE EXCEPTION 'Stale confirmation accepted'; END IF;
 UPDATE oxygen_private.payment_recovery SET completed_at=clock_timestamp() WHERE id=payment_id;
 claim:=public.oxygen_general_activation('claim',w.id,'{}');
 IF claim->>'reference' IS DISTINCT FROM ref::text OR claim->>'environment' IS DISTINCT FROM w.environment THEN RAISE EXCEPTION 'Claim binding incorrect'; END IF;
 result:=public.oxygen_general_activation('claim',w.id,'{}');
 IF result->>'status' IS DISTINCT FROM 'executing' OR result->>'environment' IS DISTINCT FROM w.environment THEN RAISE EXCEPTION 'Duplicate claim escaped fence'; END IF;
 PERFORM set_config('request.jwt.claim.sub','ba000000-0000-4000-8000-000000000099',true);
 expected_error:=false;
 BEGIN PERFORM public.oxygen_general_activation('finish',w.id,'{}'); EXCEPTION WHEN insufficient_privilege THEN expected_error:=true; END;
 IF NOT expected_error THEN RAISE EXCEPTION 'Unbound worker accepted'; END IF;
 PERFORM set_config('request.jwt.claim.sub',b.worker_user_id::text,true);
 expected_error:=false;
 BEGIN PERFORM public.oxygen_general_activation('finish',w.id,jsonb_build_object('attemptId',claim->>'attemptId','reference',app,'status','activated','ciphertext','v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',50))); EXCEPTION WHEN serialization_failure THEN expected_error:=true; END;
 IF NOT expected_error THEN RAISE EXCEPTION 'Wrong reference accepted'; END IF;
 expected_error:=false;
 BEGIN PERFORM public.oxygen_general_activation('reconcile',w.id,'{}'); EXCEPTION WHEN serialization_failure THEN expected_error:=true; END;
 IF NOT expected_error THEN RAISE EXCEPTION 'Unconfirmed activation projected'; END IF;
 PERFORM public.oxygen_general_activation('finish',w.id,jsonb_build_object('attemptId',claim->>'attemptId','reference',ref,'status','activated','ciphertext','v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',50)));
 result:=public.oxygen_general_activation('claim',w.id,'{}');
 IF result->>'status' IS DISTINCT FROM 'activated' OR result->>'environment' IS DISTINCT FROM w.environment THEN RAISE EXCEPTION 'Existing activation environment missing'; END IF;
 IF (SELECT stage FROM public.oxygen_workflows WHERE id=w.id)='activated' THEN RAISE EXCEPTION 'Evidence write prematurely projected'; END IF;
 UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{applicationReference}',to_jsonb(gen_random_uuid())) WHERE workflow_id=w.id;
 expected_error:=false;
 BEGIN PERFORM public.oxygen_general_activation('reconcile',w.id,'{}'); EXCEPTION WHEN serialization_failure THEN expected_error:=true; END;
 IF NOT expected_error THEN RAISE EXCEPTION 'Changed application accepted'; END IF;
 UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{applicationReference}',to_jsonb(app)) WHERE workflow_id=w.id;
 result:=public.oxygen_general_activation('reconcile',w.id,'{}');
 IF result->>'orderConfirmed' IS DISTINCT FROM 'true' OR (SELECT payment_status FROM public.orders WHERE id=w.order_id) IS DISTINCT FROM before_status THEN RAISE EXCEPTION 'Projection or order status wrong'; END IF;
 PERFORM public.oxygen_general_activation('reconcile',w.id,'{}');
END $$;
