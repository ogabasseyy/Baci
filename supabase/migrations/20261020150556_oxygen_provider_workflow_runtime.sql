-- Runtime identities are ordinary Auth users. No service-role user-facing client.
-- Owner provisioning must bind a staging worker and verified partner per merchant.
CREATE TABLE oxygen_private.partner_workers (
 partner_reference text PRIMARY KEY, worker_user_id uuid NOT NULL, UNIQUE(partner_reference,worker_user_id)
);
ALTER TABLE oxygen_private.partner_workers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.partner_workers FROM PUBLIC,anon,authenticated;
CREATE TABLE oxygen_private.runtime_bindings (
 merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id),
 worker_user_id uuid NOT NULL,
 partner_reference text NOT NULL CHECK (length(partner_reference) BETWEEN 1 AND 200),
 merchant_reference text,
 environment text NOT NULL DEFAULT 'staging' CHECK (environment = 'staging'),
 enabled boolean NOT NULL DEFAULT false,
 FOREIGN KEY(partner_reference,worker_user_id) REFERENCES oxygen_private.partner_workers(partner_reference,worker_user_id)
);
CREATE INDEX oxygen_runtime_partner_idx ON oxygen_private.runtime_bindings(partner_reference,worker_user_id);
CREATE INDEX oxygen_runtime_worker_idx ON oxygen_private.runtime_bindings(worker_user_id);
CREATE TABLE oxygen_private.provider_states (
 workflow_id uuid PRIMARY KEY REFERENCES public.oxygen_workflows(id),
 state jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(state) = 'object')
);
CREATE UNIQUE INDEX oxygen_state_application_idx ON oxygen_private.provider_states((state->>'applicationReference')) WHERE state ? 'applicationReference';
CREATE UNIQUE INDEX oxygen_state_booking_idx ON oxygen_private.provider_states((state->>'bookingReference')) WHERE state ? 'bookingReference';
CREATE INDEX oxygen_state_phone_idx ON oxygen_private.provider_states((state->>'phone'));
CREATE TABLE oxygen_private.provider_reference_history (
 command_id uuid PRIMARY KEY REFERENCES oxygen_private.commands(id),
 workflow_id uuid NOT NULL REFERENCES public.oxygen_workflows(id),
 application_reference uuid, booking_reference uuid, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oxygen_reference_history_workflow_idx ON oxygen_private.provider_reference_history(workflow_id);
ALTER TABLE oxygen_private.runtime_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxygen_private.provider_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxygen_private.provider_reference_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.runtime_bindings,oxygen_private.provider_states,oxygen_private.provider_reference_history FROM PUBLIC,anon,authenticated;

CREATE FUNCTION oxygen_private.runtime(p_operation text,p_id uuid,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; b oxygen_private.runtime_bindings%ROWTYPE;
 c oxygen_private.commands%ROWTYPE; v_state jsonb; v_result jsonb; v_order record;
 v_worker boolean; v_action text; v_key uuid; v_version integer;
BEGIN
 IF auth.uid() IS NULL OR pg_catalog.octet_length(p_payload::text)>262144 THEN
  RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';
 END IF;
 IF p_operation NOT IN ('status','worker_status','enqueue','reconcile','claim','finish') THEN RAISE EXCEPTION 'Unsupported action' USING ERRCODE='22023'; END IF;
 v_worker := p_operation IN ('worker_status','reconcile','claim','finish');
 IF p_operation IN ('claim','finish') THEN
  SELECT workflow_id INTO p_id FROM oxygen_private.commands WHERE id=p_id;
 END IF;
 SELECT id,order_id,merchant_id,customer_id,created_channel,environment,stage,version,created_at,updated_at
 INTO w FROM public.oxygen_workflows WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Workflow not found' USING ERRCODE='42501'; END IF;
 SELECT merchant_id,worker_user_id,partner_reference,merchant_reference,environment,enabled INTO b
 FROM oxygen_private.runtime_bindings WHERE merchant_id=w.merchant_id FOR SHARE;
 SELECT o.total,o.customer_phone,o.order_number,o.currency,o.payment_status,o.cancelled_at,o.shipping_address,
  coalesce(o.shipping_address->>'address',o.shipping_address->>'address_line1','') AS address
 INTO v_order FROM public.orders o JOIN public.customers u ON u.id=o.customer_id AND u.merchant_id=o.merchant_id
 WHERE o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id
  AND (v_worker OR u.user_id=auth.uid()) FOR SHARE OF o,u;
 IF NOT FOUND OR (v_worker AND (b.worker_user_id IS DISTINCT FROM auth.uid() OR NOT coalesce(b.enabled,false))) THEN
  RAISE EXCEPTION 'Workflow not found' USING ERRCODE='42501';
 END IF;
 SELECT state INTO v_state FROM oxygen_private.provider_states WHERE workflow_id=w.id;
 v_state:=coalesce(v_state,'{}');
 IF p_operation IN ('status','worker_status') THEN
  RETURN jsonb_build_object('workflowId',w.id,'stage',w.stage,'version',w.version,'environment',w.environment,
   'executionEnabled',coalesce(b.enabled,false) AND v_order.payment_status='unpaid' AND v_order.cancelled_at IS NULL AND v_order.currency='NGN','state',(v_state-ARRAY['newUserToken','activityToken','phone']) - CASE WHEN v_order.payment_status<>'unpaid' OR v_order.cancelled_at IS NOT NULL THEN ARRAY['paymentUrl','setupUrl'] ELSE ARRAY[]::text[] END,
   'approvalOtpReady',v_state ? 'activityToken','checkoutPhone',coalesce(v_order.customer_phone,''),
   'checkoutAddress',jsonb_build_object('state',coalesce(v_order.shipping_address->>'state',''),'lga',coalesce(v_order.shipping_address->>'lga',''),'city',coalesce(v_order.shipping_address->>'city',''),'street',coalesce(v_order.shipping_address->>'street',v_order.shipping_address->>'address',''),'landmark',coalesce(v_order.shipping_address->>'landmark',''),'house_number',coalesce(v_order.shipping_address->>'house_number','')),
   'pending',(SELECT jsonb_build_object('action',command->>'action','status',status,'idempotencyKey',idempotency_key) FROM oxygen_private.commands WHERE workflow_id=w.id AND status IN ('queued','executing','indeterminate') LIMIT 1),'activationEnabled',false,'settlementEnabled',false);
 END IF;
 IF NOT coalesce(b.enabled,false) OR b.environment<>'staging' OR w.environment<>'staging' THEN
  RAISE EXCEPTION 'Provider connection unavailable' USING ERRCODE='55000';
 END IF;
 IF p_operation IN ('enqueue','reconcile') THEN
  v_action:=p_payload->'command'->>'action'; v_key:=(p_payload->>'idempotencyKey')::uuid;
  v_version:=(p_payload->>'version')::integer;
  IF p_operation='reconcile' AND v_action NOT IN ('refresh_kyc','refresh_payment_setup') THEN RAISE EXCEPTION 'Unsupported reconciliation' USING ERRCODE='22023'; END IF;
  IF v_action IS NULL OR v_action NOT IN ('start_application','validate_customer','resend_customer_otp','refresh_eligibility','refresh_kyc','validate_nin','selfie_link','book','submit_address','refresh_details','trigger_approval_otp','approve_booking','cancel_booking','refresh_payment_setup')
   OR ((p_payload->'command') - ARRAY['action','equityPercentage','tenure'])<>'{}'::jsonb THEN
   RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';
  END IF;
  SELECT id,workflow_id,idempotency_key,expected_version,channel,command,status,created_at,started_at,completed_at INTO c
   FROM oxygen_private.commands WHERE workflow_id=w.id AND idempotency_key=v_key;
  IF FOUND THEN
   IF c.command IS DISTINCT FROM p_payload->'command' OR (p_operation='enqueue' AND c.expected_version IS DISTINCT FROM v_version) THEN
    RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='22023';
   END IF;
   RETURN jsonb_build_object('commandId',c.id,'status',c.status);
  END IF;
  IF w.version<>v_version OR w.stage IN ('activated','reconciliation_required') THEN RAISE EXCEPTION 'Stale workflow' USING ERRCODE='40001'; END IF;
  IF v_order.cancelled_at IS NOT NULL OR v_order.currency<>'NGN' OR v_order.total<=0 THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='22023'; END IF;
  -- A pending ordinary gateway payment must not also start a BNPL booking.
  IF v_action IN ('start_application','book') AND v_order.payment_status<>'unpaid' THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='22023'; END IF;
  INSERT INTO oxygen_private.commands(workflow_id,idempotency_key,expected_version,channel,command)
   VALUES(w.id,v_key,v_version,w.created_channel,p_payload->'command') RETURNING id INTO c.id;
  RETURN jsonb_build_object('commandId',c.id,'status','queued');
 END IF;
 SELECT id,workflow_id,idempotency_key,expected_version,channel,command,status,created_at,started_at,completed_at INTO c
 FROM oxygen_private.commands WHERE id=(p_payload->>'commandId')::uuid AND workflow_id=w.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Command not found' USING ERRCODE='42501'; END IF;
 IF p_operation='claim' THEN
  IF c.command->>'action' IN ('start_application','book','trigger_approval_otp','approve_booking') AND (v_order.payment_status<>'unpaid' OR v_order.cancelled_at IS NOT NULL OR v_order.currency<>'NGN' OR v_order.total<=0) THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='22023'; END IF;
  v_result:=oxygen_private.claim_command(c.id);
  IF v_result IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('command',c.command,'context',jsonb_build_object(
   'workflowId',w.id,'stage',w.stage,'version',w.version,'environment',w.environment,
   'partnerReference',b.partner_reference,'merchantReference',b.merchant_reference,
   'orderId',w.order_id,'productAmount',v_order.total,'orderPhone',coalesce(v_order.customer_phone,''),
   'productName','Order '||v_order.order_number,'address',v_order.address,'state',v_state));
 END IF;
 IF p_payload->>'outcome'='succeeded' THEN
  IF p_payload->'state'->'booking'->>'product_amount' IS NOT NULL AND (p_payload->'state'->'booking'->>'product_amount')::numeric <> v_order.total THEN RAISE EXCEPTION 'Order amount changed' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_payload->'state') IS DISTINCT FROM 'object' OR
   ((p_payload->'state') - ARRAY['applicationReference','bookingReference','phone','customerPath','newUserToken','activityToken','validated','eligible','eligibleAmount','minimumAmount','maxTenure','kyc','booking','paymentComplete','setupComplete','paymentUrl','setupUrl','selfieUrl','schedule','quotedCharges'])<>'{}'::jsonb THEN
   RAISE EXCEPTION 'Invalid provider state' USING ERRCODE='22023';
  END IF;
  INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES(w.id,p_payload->'state')
   ON CONFLICT(workflow_id) DO UPDATE SET state=excluded.state;
  INSERT INTO oxygen_private.provider_reference_history(command_id,workflow_id,application_reference,booking_reference)
   VALUES(c.id,w.id,(p_payload->'state'->>'applicationReference')::uuid,(p_payload->'state'->>'bookingReference')::uuid);
 END IF;
 PERFORM oxygen_private.record_command(c.id,p_payload->>'outcome',p_payload->>'stage');
 RETURN jsonb_build_object('recorded',true);
END $$;
REVOKE ALL ON FUNCTION oxygen_private.runtime(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION oxygen_private.runtime(text,uuid,jsonb) TO authenticated;
CREATE FUNCTION public.oxygen_runtime(p_operation text,p_id uuid,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT oxygen_private.runtime(p_operation,p_id,p_payload);
$$;
REVOKE ALL ON FUNCTION public.oxygen_runtime(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_runtime(text,uuid,jsonb) TO authenticated;
