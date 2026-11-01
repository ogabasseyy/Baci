-- General activation and ordinary commands serialize on the workflow row.
-- Keep status readable while fencing changes during an in-flight/uncertain activation.
DO $$ DECLARE definition text; needle text := ' IF p_operation IN (''enqueue'',''reconcile'') THEN';
BEGIN
 definition:=pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen runtime definition'; END IF;
 definition:=replace(definition,needle, $replacement$
 IF p_operation IN ('enqueue','reconcile','claim') AND EXISTS
  (SELECT 1 FROM oxygen_private.general_activations g WHERE g.workflow_id=w.id AND g.status IN ('executing','indeterminate'))
 THEN RAISE EXCEPTION 'Activation pending' USING ERRCODE='40001'; END IF;
 IF p_operation IN ('enqueue','reconcile') THEN$replacement$);
 EXECUTE definition;
END $$;

CREATE OR REPLACE FUNCTION oxygen_private.response_evidence_access(p_operation text,p_command_id uuid,p_sequence integer DEFAULT 1,p_ciphertext text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE merchant uuid; command_status text; result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Evidence unavailable' USING ERRCODE='42501'; END IF;
 SELECT w.merchant_id,c.status INTO merchant,command_status
 FROM oxygen_private.commands c JOIN public.oxygen_workflows w ON w.id=c.workflow_id
 JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id
 WHERE c.id=p_command_id AND b.environment=w.environment
 AND b.enabled AND b.worker_user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Evidence unavailable' USING ERRCODE='42501'; END IF;
 IF p_operation='record' THEN
  IF command_status<>'executing' OR p_sequence IS NULL OR p_sequence NOT BETWEEN 1 AND 20 OR p_ciphertext IS NULL
   OR octet_length(p_ciphertext) NOT BETWEEN 40 AND 32768
   OR p_ciphertext !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
  THEN RAISE EXCEPTION 'Evidence unavailable'; END IF;
  INSERT INTO oxygen_private.response_evidence(command_id,sequence,ciphertext) VALUES(p_command_id,p_sequence,p_ciphertext) ON CONFLICT DO NOTHING;
  DELETE FROM oxygen_private.response_evidence e USING oxygen_private.commands c,public.oxygen_workflows w
  WHERE e.command_id=c.id AND c.workflow_id=w.id AND w.merchant_id=merchant AND e.expires_at<=now();
  RETURN jsonb_build_object('recorded',true);
 ELSIF p_operation='read' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('sequence',sequence,'ciphertext',ciphertext,'createdAt',created_at,'expiresAt',expires_at) ORDER BY sequence),'[]'::jsonb)
  INTO result FROM oxygen_private.response_evidence WHERE command_id=p_command_id AND expires_at>now();
  RETURN result;
 END IF;
 RAISE EXCEPTION 'Evidence unavailable';
END $$;

CREATE OR REPLACE FUNCTION oxygen_private.payment_recovery_access(p_operation text,p_workflow_id uuid,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; b oxygen_private.runtime_bindings%ROWTYPE;
 a oxygen_private.payment_recovery%ROWTYPE; owner_id uuid; current_ref uuid; provider jsonb; order_status text;
 cancelled timestamptz; current_currency text; v_result jsonb; v_status jsonb; payment_url text; setup_url text;
 checked_at timestamptz; latest_outcome text; running boolean; blocked boolean; worker_op boolean;
BEGIN
 IF auth.uid() IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>131072 THEN RAISE EXCEPTION 'Recovery unavailable' USING ERRCODE='42501'; END IF;
 IF p_operation NOT IN ('status','enqueue','abandon','claim','evidence','evidence_read','finish') THEN RAISE EXCEPTION 'Recovery unavailable' USING ERRCODE='22023'; END IF;
 worker_op:=p_operation IN ('claim','evidence','evidence_read','finish');
 SELECT * INTO w FROM public.oxygen_workflows WHERE id=p_workflow_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recovery unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM oxygen_private.runtime_bindings WHERE merchant_id=w.merchant_id FOR SHARE;
 SELECT u.user_id,o.payment_status,o.cancelled_at,o.currency INTO owner_id,order_status,cancelled,current_currency
 FROM public.orders o JOIN public.customers u ON u.id=o.customer_id AND u.merchant_id=o.merchant_id
 WHERE o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id FOR SHARE OF o,u;
 IF NOT FOUND OR NOT coalesce(b.enabled,false) OR b.environment IS DISTINCT FROM w.environment
 OR (worker_op AND b.worker_user_id IS DISTINCT FROM auth.uid()) OR (NOT worker_op AND owner_id IS DISTINCT FROM auth.uid())
 THEN RAISE EXCEPTION 'Recovery unavailable' USING ERRCODE='42501'; END IF;
 SELECT state INTO provider FROM oxygen_private.provider_states WHERE workflow_id=w.id;
 current_ref:=(provider->>'bookingReference')::uuid;
 IF p_operation NOT IN ('evidence','evidence_read') AND (current_ref IS NULL OR cancelled IS NOT NULL OR current_currency<>'NGN' OR w.stage='activated'
 OR (w.stage='reconciliation_required' AND NOT EXISTS(SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w.id AND c.status='indeterminate' AND c.command->>'action'='approve_booking'))
 OR EXISTS(SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w.id AND c.status IN ('queued','executing'))
) THEN RAISE EXCEPTION 'Recovery unavailable' USING ERRCODE='40001'; END IF;
 IF p_operation='status' THEN
  SELECT result,completed_at INTO v_status,checked_at FROM oxygen_private.payment_recovery
  WHERE workflow_id=w.id AND booking_reference=current_ref AND action='check_status' AND status='succeeded' ORDER BY created_at DESC,id DESC LIMIT 1;
  v_status:=coalesce(v_status,jsonb_build_object('paymentComplete',provider->'paymentComplete','setupComplete',provider->'setupComplete'));
  SELECT result->>'paymentUrl' INTO payment_url FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND booking_reference=current_ref AND action='resend_upfront' AND status='succeeded' ORDER BY created_at DESC,id DESC LIMIT 1;
  SELECT result->>'setupUrl' INTO setup_url FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND booking_reference=current_ref AND action='resend_repayment' AND status='succeeded' ORDER BY created_at DESC,id DESC LIMIT 1;
  payment_url:=coalesce(payment_url,provider->>'paymentUrl');
  setup_url:=coalesce(setup_url,provider->>'setupUrl');
  SELECT status INTO latest_outcome FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND booking_reference=current_ref AND status IN ('succeeded','failed','indeterminate') ORDER BY created_at DESC,id DESC LIMIT 1;
  SELECT EXISTS(SELECT 1 FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND status IN ('queued','executing')) INTO running;
  SELECT EXISTS(SELECT 1 FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND booking_reference=current_ref AND action=CASE WHEN (v_status->>'paymentComplete')::boolean THEN 'resend_repayment' ELSE 'resend_upfront' END AND status='indeterminate') INTO blocked;
  RETURN jsonb_build_object('reference',current_ref,'paymentComplete',v_status->'paymentComplete','setupComplete',v_status->'setupComplete','checkedAt',checked_at,
   'paymentUrl',CASE WHEN order_status='unpaid' AND NOT blocked AND coalesce((v_status->>'paymentComplete')::boolean,false)=false THEN payment_url ELSE NULL END,
   'setupUrl',CASE WHEN order_status='unpaid' AND NOT blocked AND coalesce((v_status->>'setupComplete')::boolean,false)=false THEN setup_url ELSE NULL END,
   'lastOutcome',latest_outcome,'pending',running,'resendBlocked',blocked);
 END IF;
 -- Activation holds the same workflow lock; status checks remain available,
 -- but no new provider resend can race or follow an uncertain activation.
 IF p_operation='enqueue' AND p_payload->>'action' IS DISTINCT FROM 'check_status'
  AND EXISTS(SELECT 1 FROM oxygen_private.general_activations g WHERE g.workflow_id=w.id AND g.status IN ('executing','indeterminate'))
 THEN RAISE EXCEPTION 'Activation pending' USING ERRCODE='40001'; END IF;
 IF p_operation='enqueue' THEN
  IF p_payload-ARRAY['workflowId','reference','version','idempotencyKey','action']<>'{}'::jsonb OR p_payload->>'action' IS NULL OR p_payload->>'action' NOT IN ('check_status','resend_upfront','resend_repayment')
  OR p_payload->>'workflowId' IS DISTINCT FROM w.id::text OR (p_payload->>'reference')::uuid IS DISTINCT FROM current_ref OR (p_payload->>'version')::integer IS DISTINCT FROM w.version OR p_payload->>'idempotencyKey' IS NULL
  THEN RAISE EXCEPTION 'Stale recovery request' USING ERRCODE='40001'; END IF;
  SELECT * INTO a FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND idempotency_key=(p_payload->>'idempotencyKey')::uuid;
  IF FOUND THEN
   IF a.action IS DISTINCT FROM p_payload->>'action' OR a.expected_version<>w.version OR a.booking_reference<>current_ref THEN RAISE EXCEPTION 'Recovery idempotency conflict'; END IF;
   RETURN jsonb_build_object('commandId',a.id,'status',a.status);
  END IF;
  IF p_payload->>'action'<>'check_status' THEN
   IF order_status<>'unpaid' OR NOT coalesce(provider->'booking'->>'status'='APPROVED' OR w.stage='reconciliation_required',false)
    OR EXISTS(SELECT 1 FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND booking_reference=current_ref AND action=p_payload->>'action' AND status='indeterminate')
   THEN RAISE EXCEPTION 'Recovery confirmation required'; END IF;
   SELECT result,completed_at INTO v_status,checked_at FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND booking_reference=current_ref AND action='check_status' AND status='succeeded' ORDER BY created_at DESC,id DESC LIMIT 1;
   IF checked_at IS NULL OR checked_at<now()-interval '5 minutes' OR
    (CASE WHEN p_payload->>'action'='resend_upfront' THEN (v_status->>'paymentComplete')::boolean ELSE (v_status->>'setupComplete')::boolean END) IS DISTINCT FROM false
   THEN RAISE EXCEPTION 'Fresh incomplete payment status required'; END IF;
  END IF;
  INSERT INTO oxygen_private.payment_recovery(workflow_id,booking_reference,expected_version,idempotency_key,action)
  VALUES(w.id,current_ref,w.version,(p_payload->>'idempotencyKey')::uuid,p_payload->>'action') RETURNING * INTO a;
  RETURN jsonb_build_object('commandId',a.id,'status',a.status);
 END IF;
 SELECT * INTO a FROM oxygen_private.payment_recovery WHERE id=(p_payload->>'commandId')::uuid AND workflow_id=w.id FOR UPDATE;
 IF NOT FOUND OR (p_operation NOT IN ('evidence','evidence_read') AND (a.booking_reference<>current_ref OR a.expected_version<>w.version)) THEN RAISE EXCEPTION 'Stale recovery command' USING ERRCODE='40001'; END IF;
 IF p_operation='abandon' THEN
  IF a.status<>'queued' THEN RAISE EXCEPTION 'Recovery already claimed'; END IF;
  UPDATE oxygen_private.payment_recovery SET status='failed',completed_at=clock_timestamp() WHERE id=a.id;
  RETURN jsonb_build_object('recorded',true);
 END IF;
 IF p_operation='claim' AND a.action<>'check_status'
  AND EXISTS(SELECT 1 FROM oxygen_private.general_activations g WHERE g.workflow_id=w.id AND g.status IN ('executing','indeterminate'))
 THEN RAISE EXCEPTION 'Activation pending' USING ERRCODE='40001'; END IF;
 IF p_operation='claim' THEN
  IF a.status<>'queued' THEN RETURN NULL; END IF;
  IF a.action<>'check_status' AND order_status<>'unpaid' THEN RAISE EXCEPTION 'Order unavailable'; END IF;
  UPDATE oxygen_private.payment_recovery SET status='executing' WHERE id=a.id;
  RETURN jsonb_build_object('reference',current_ref,'action',a.action,'environment',w.environment);
 END IF;
 IF p_operation='evidence_read' THEN RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('sequence',sequence,'ciphertext',ciphertext) ORDER BY sequence),'[]'::jsonb) FROM oxygen_private.payment_recovery_evidence WHERE command_id=a.id AND expires_at>now()); END IF;
 IF a.status<>'executing' THEN RAISE EXCEPTION 'Recovery not executing'; END IF;
 IF p_operation='evidence' THEN
  IF p_payload->>'sequence' IS NULL OR (p_payload->>'sequence')::integer NOT BETWEEN 1 AND 20 OR p_payload->>'ciphertext' IS NULL
   OR octet_length(p_payload->>'ciphertext') NOT BETWEEN 40 AND 65536 OR p_payload->>'ciphertext' !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$' THEN RAISE EXCEPTION 'Invalid evidence'; END IF;
  INSERT INTO oxygen_private.payment_recovery_evidence(command_id,sequence,ciphertext) VALUES(a.id,(p_payload->>'sequence')::integer,p_payload->>'ciphertext') ON CONFLICT DO NOTHING;
  DELETE FROM oxygen_private.payment_recovery_evidence e USING oxygen_private.payment_recovery r WHERE e.command_id=r.id AND r.workflow_id=w.id AND e.expires_at<=now();
  RETURN jsonb_build_object('recorded',true);
 END IF;
 v_result:=coalesce(p_payload->'result','{}');
 IF p_payload->>'outcome' IS NULL OR p_payload->>'outcome' NOT IN ('succeeded','failed','indeterminate') OR jsonb_typeof(v_result)<>'object' OR octet_length(v_result::text)>45000 THEN RAISE EXCEPTION 'Invalid recovery result'; END IF;
 IF p_payload->>'outcome'='succeeded' THEN
  IF a.action='check_status' THEN
   IF v_result-ARRAY['paymentComplete','setupComplete']<>'{}'::jsonb OR jsonb_typeof(v_result->'paymentComplete') IS DISTINCT FROM 'boolean' OR jsonb_typeof(v_result->'setupComplete') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid status'; END IF;
  ELSE
   IF order_status<>'unpaid' THEN RAISE EXCEPTION 'Order unavailable'; END IF;
   payment_url:=CASE WHEN a.action='resend_upfront' THEN v_result->>'paymentUrl' ELSE v_result->>'setupUrl' END;
   IF (a.action='resend_upfront' AND v_result-ARRAY['paymentUrl']<>'{}'::jsonb) OR (a.action='resend_repayment' AND v_result-ARRAY['setupUrl']<>'{}'::jsonb)
    OR payment_url IS NULL OR length(payment_url)>20000 OR payment_url !~ '^https://[^/@:?#[:space:]]+([/?#]|$)' THEN RAISE EXCEPTION 'Invalid hosted URL'; END IF;
  END IF;
 ELSE
  IF v_result<>'{}'::jsonb THEN RAISE EXCEPTION 'Failure cannot overwrite result'; END IF;
 END IF;
 IF p_payload->'diagnostic' IS NOT NULL AND p_payload->'diagnostic'<>'null'::jsonb AND (jsonb_typeof(p_payload->'diagnostic')<>'object' OR octet_length((p_payload->'diagnostic')::text)>4096 OR (p_payload->'diagnostic')-ARRAY['operation','kind','outcome','httpStatus','providerCode','providerMessage','providerRequestId','capture','occurredAt','durationMs']<>'{}'::jsonb) THEN RAISE EXCEPTION 'Invalid diagnostic'; END IF;
 UPDATE oxygen_private.payment_recovery SET status=p_payload->>'outcome',result=v_result,diagnostic=p_payload->'diagnostic',completed_at=clock_timestamp() WHERE id=a.id;
 RETURN jsonb_build_object('recorded',true);
END $$;

CREATE OR REPLACE FUNCTION oxygen_private.callback_payment(p_workflow_id uuid,p_callback_id uuid,p_retry_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; b oxygen_private.runtime_bindings%ROWTYPE;
 i oxygen_private.callback_inbox%ROWTYPE; a oxygen_private.payment_recovery%ROWTYPE;
 provider jsonb; current_ref uuid; cancelled timestamptz; currency text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Callback unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM public.oxygen_workflows WHERE id=p_workflow_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Callback unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM oxygen_private.runtime_bindings WHERE merchant_id=w.merchant_id FOR SHARE;
 IF NOT FOUND OR NOT b.enabled OR b.environment IS DISTINCT FROM w.environment OR b.worker_user_id IS DISTINCT FROM auth.uid()
 THEN RAISE EXCEPTION 'Callback unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM oxygen_private.callback_inbox WHERE id=p_callback_id FOR UPDATE;
 IF NOT FOUND OR i.partner_reference IS DISTINCT FROM b.partner_reference OR i.environment IS DISTINCT FROM w.environment OR i.status<>'queued'
 OR i.next_attempt_at>now() OR i.retry_key IS DISTINCT FROM p_retry_key OR i.event->>'kind' IS DISTINCT FROM 'transaction'
 THEN RAISE EXCEPTION 'Callback unavailable' USING ERRCODE='42501'; END IF;
 SELECT state INTO provider FROM oxygen_private.provider_states WHERE workflow_id=w.id;
 current_ref:=(provider->>'bookingReference')::uuid;
 IF current_ref IS NULL OR i.event->>'bookedLoanReference' IS DISTINCT FROM current_ref::text
 THEN RAISE EXCEPTION 'Callback unavailable' USING ERRCODE='42501'; END IF;
 SELECT o.cancelled_at,o.currency INTO cancelled,currency FROM public.orders o
 JOIN public.customers c ON c.id=o.customer_id AND c.merchant_id=o.merchant_id
 WHERE o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id FOR SHARE OF o,c;
 IF NOT FOUND OR cancelled IS NOT NULL OR currency<>'NGN'
 OR w.stage NOT IN ('payment_required','ready_for_activation','reconciliation_required')
 OR (w.stage='reconciliation_required' AND NOT EXISTS(SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w.id AND c.status='indeterminate' AND c.command->>'action'='approve_booking'))
 OR EXISTS(SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w.id AND
 (c.status IN ('queued','executing') OR (c.status='indeterminate' AND c.command->>'action'<>'approve_booking')))
 THEN RAISE EXCEPTION 'Callback recovery blocked' USING ERRCODE='40001'; END IF;
 SELECT * INTO a FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND idempotency_key=p_retry_key;
 IF FOUND THEN
  IF a.action<>'check_status' OR a.expected_version<>w.version OR a.booking_reference<>current_ref THEN RAISE EXCEPTION 'Callback recovery conflict' USING ERRCODE='40001'; END IF;
 ELSE
  -- Workflow lock serializes against customer recovery enqueue/claim.
  IF EXISTS(SELECT 1 FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND status IN ('queued','executing')) THEN RAISE EXCEPTION 'Callback recovery pending' USING ERRCODE='40001'; END IF;
  INSERT INTO oxygen_private.payment_recovery(workflow_id,booking_reference,expected_version,idempotency_key,action)
  VALUES(w.id,current_ref,w.version,p_retry_key,'check_status') RETURNING * INTO a;
 END IF;
 RETURN jsonb_build_object('commandId',a.id,'reference',current_ref,'status',a.status,'environment',w.environment,
  'result',CASE WHEN a.status='succeeded' AND jsonb_typeof(a.result->'paymentComplete')='boolean'
   AND jsonb_typeof(a.result->'setupComplete')='boolean'
   THEN jsonb_build_object('paymentComplete',a.result->'paymentComplete','setupComplete',a.result->'setupComplete')
   ELSE NULL END);
END $$;

CREATE OR REPLACE FUNCTION oxygen_private.approval_code_window(p_workflow_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE current_reference text; has_token boolean; sent_at timestamptz;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 SELECT s.state->>'bookingReference',s.state ? 'activityToken'
 INTO current_reference,has_token
 FROM public.oxygen_workflows w
 JOIN public.orders o ON o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id
 JOIN public.customers u ON u.id=w.customer_id AND u.merchant_id=w.merchant_id
 LEFT JOIN oxygen_private.provider_states s ON s.workflow_id=w.id
 WHERE w.id=p_workflow_id AND u.user_id=auth.uid() AND EXISTS (SELECT 1 FROM oxygen_private.runtime_bindings b
  WHERE b.merchant_id=w.merchant_id AND b.environment=w.environment AND b.enabled);
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF current_reference IS NULL OR NOT coalesce(has_token,false) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM oxygen_private.commands WHERE workflow_id=p_workflow_id
   AND command->>'action'='trigger_approval_otp' AND status IN ('queued','executing','indeterminate')) THEN RETURN NULL; END IF;
 -- Use request-start time conservatively: provider/network delay cannot extend the code window.
 SELECT coalesce(c.started_at,c.completed_at) INTO sent_at
 FROM oxygen_private.commands c
 JOIN oxygen_private.provider_reference_history h ON h.command_id=c.id AND h.workflow_id=c.workflow_id
 WHERE c.workflow_id=p_workflow_id AND c.command->>'action'='trigger_approval_otp'
   AND c.status='succeeded' AND h.booking_reference::text=current_reference
 ORDER BY c.completed_at DESC,c.id DESC LIMIT 1;
 IF sent_at IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('bookingReference',current_reference,'sentAt',sent_at,'expiresAt',sent_at+interval '5 minutes');
END $$;

NOTIFY pgrst, 'reload schema';
