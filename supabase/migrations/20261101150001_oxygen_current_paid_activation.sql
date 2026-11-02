-- Authorize only the current paid staging booking in addition to the earlier trial.
-- No production activation, settlement, or reset of existing activation attempts.
INSERT INTO oxygen_private.activation_trials(workflow_id,booking_reference)
SELECT w.id,'1e65cf4b-4942-4ade-8149-e894687f6c40'::uuid
FROM public.oxygen_workflows w JOIN oxygen_private.provider_states s ON s.workflow_id=w.id
WHERE w.id='1c0459fe-2d45-4d2c-b41a-0ac640ad9f89' AND w.environment='staging'
AND s.state->>'bookingReference'='1e65cf4b-4942-4ade-8149-e894687f6c40'
AND s.state->'booking'->>'status'='APPROVED'
ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION oxygen_private.activation_trial(p_operation text,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; b oxygen_private.runtime_bindings%ROWTYPE;
 t oxygen_private.activation_trials%ROWTYPE; owner_id uuid; current_ref text; cancelled timestamptz;
 worker_op boolean; payment jsonb;
BEGIN
 IF auth.uid() IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>100000
 OR p_operation NOT IN ('status','enqueue','claim','evidence','finish') THEN RAISE EXCEPTION 'Trial unavailable' USING ERRCODE='42501'; END IF;
 SELECT id,merchant_id,customer_id,order_id,environment INTO w.id,w.merchant_id,w.customer_id,w.order_id,w.environment FROM public.oxygen_workflows WHERE id=coalesce((p_payload->>'workflowId')::uuid,'52ab6696-762b-4e9f-8f99-a9d926a29b2c'::uuid)
 AND id IN ('52ab6696-762b-4e9f-8f99-a9d926a29b2c'::uuid,'1c0459fe-2d45-4d2c-b41a-0ac640ad9f89'::uuid) FOR UPDATE;
 IF NOT FOUND OR w.environment<>'staging' THEN RAISE EXCEPTION 'Trial unavailable' USING ERRCODE='42501'; END IF;
 SELECT enabled,environment,worker_user_id INTO b.enabled,b.environment,b.worker_user_id FROM oxygen_private.runtime_bindings WHERE merchant_id=w.merchant_id FOR SHARE;
 SELECT c.user_id,o.cancelled_at INTO owner_id,cancelled FROM public.orders o JOIN public.customers c ON c.id=o.customer_id AND c.merchant_id=o.merchant_id
 WHERE o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id FOR SHARE OF o,c;
 worker_op:=p_operation IN ('claim','evidence','finish') OR (p_operation IN ('enqueue','status') AND b.worker_user_id=auth.uid());
 IF NOT FOUND OR NOT coalesce(b.enabled,false) OR b.environment<>'staging'
 OR (worker_op AND b.worker_user_id IS DISTINCT FROM auth.uid()) OR (NOT worker_op AND owner_id IS DISTINCT FROM auth.uid())
 THEN RAISE EXCEPTION 'Trial unavailable' USING ERRCODE='42501'; END IF;
 SELECT booking_reference,status,result,evidence INTO t.booking_reference,t.status,t.result,t.evidence FROM oxygen_private.activation_trials WHERE workflow_id=w.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trial unavailable' USING ERRCODE='42501'; END IF;
 IF p_operation='status' THEN RETURN jsonb_build_object('status',t.status,'result',t.result); END IF;
 SELECT state->>'bookingReference' INTO current_ref FROM oxygen_private.provider_states WHERE workflow_id=w.id;
 IF current_ref IS DISTINCT FROM t.booking_reference::text OR cancelled IS NOT NULL THEN RAISE EXCEPTION 'Trial binding changed' USING ERRCODE='40001'; END IF;
 IF p_operation='enqueue' THEN
  IF t.status<>'ready' THEN RETURN jsonb_build_object('status',t.status); END IF;
  SELECT result INTO payment FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND booking_reference=t.booking_reference AND action='check_status' AND status='succeeded' ORDER BY created_at DESC LIMIT 1;
  -- Normal workflow status reads and callback recovery both provide durable confirmation.
  IF EXISTS (SELECT 1 FROM oxygen_private.provider_states s JOIN public.oxygen_workflows v ON v.id=s.workflow_id
   WHERE s.workflow_id=w.id AND v.stage='ready_for_activation'
   AND s.state->>'bookingReference'=t.booking_reference::text
   AND s.state->>'paymentComplete'='true' AND s.state->>'setupComplete'='true') THEN
   payment:=jsonb_build_object('paymentComplete',true,'setupComplete',true);
  END IF;
  IF payment->>'paymentComplete' IS DISTINCT FROM 'true' OR payment->>'setupComplete' IS DISTINCT FROM 'true'
  OR EXISTS(SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w.id AND (c.status IN ('queued','executing') OR(c.status='indeterminate' AND c.command->>'action'<>'approve_booking')))
  OR EXISTS(SELECT 1 FROM oxygen_private.payment_recovery r WHERE r.workflow_id=w.id AND r.status IN ('queued','executing')) THEN RAISE EXCEPTION 'Trial blocked' USING ERRCODE='40001'; END IF;
  UPDATE oxygen_private.activation_trials SET status='queued' WHERE workflow_id=w.id;
  RETURN jsonb_build_object('status','queued');
 END IF;
 IF p_operation='claim' THEN
  IF t.status<>'queued' THEN RETURN NULL; END IF;
  UPDATE oxygen_private.activation_trials SET status='executing' WHERE workflow_id=w.id;
  RETURN jsonb_build_object('status','executing','reference',t.booking_reference);
 END IF;
 IF t.status<>'executing' THEN RAISE EXCEPTION 'Trial not executing' USING ERRCODE='40001'; END IF;
 IF p_operation='evidence' THEN
  IF jsonb_array_length(t.evidence)>=32 OR jsonb_typeof(p_payload->'capture') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid evidence'; END IF;
  UPDATE oxygen_private.activation_trials SET evidence=evidence||jsonb_build_array(p_payload) WHERE workflow_id=w.id;
  RETURN jsonb_build_object('recorded',true);
 END IF;
 IF p_payload->>'status' IS NULL OR p_payload->>'status' NOT IN ('activated','rejected','indeterminate') OR jsonb_typeof(p_payload->'result') IS DISTINCT FROM 'object'
 OR (p_payload->'result')-ARRAY['loan_reference','status','alreadyActivated','loan_amount','product_amount','equity_percentage','equity_amount','total_charges','total_upfront_payment','first_repayment','loan_tenure']<>'{}' THEN RAISE EXCEPTION 'Invalid result'; END IF;
 IF p_payload->>'status'='activated' AND (p_payload->'result'->>'loan_reference' IS DISTINCT FROM t.booking_reference::text OR p_payload->'result'->>'status' IS DISTINCT FROM 'ACTIVATED') THEN RAISE EXCEPTION 'Activation unconfirmed'; END IF;
 UPDATE oxygen_private.activation_trials SET status=p_payload->>'status',result=p_payload->'result',completed_at=clock_timestamp() WHERE workflow_id=w.id;
 RETURN jsonb_build_object('recorded',true);
END $$;
REVOKE ALL ON FUNCTION oxygen_private.activation_trial(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION oxygen_private.activation_trial(text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
