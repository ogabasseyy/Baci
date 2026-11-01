-- Owner-authorized one-use staging activation trial. Global runtime activation remains disabled.
CREATE TABLE oxygen_private.activation_trials (
 workflow_id uuid PRIMARY KEY REFERENCES public.oxygen_workflows(id),
 booking_reference uuid NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','queued','executing','activated','rejected','indeterminate')),
 result jsonb NOT NULL DEFAULT '{}',
 evidence jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
ALTER TABLE oxygen_private.activation_trials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.activation_trials FROM PUBLIC,anon,authenticated;
-- Exact current application only; no permission is conferred on older bookings.
INSERT INTO oxygen_private.activation_trials(workflow_id,booking_reference)
SELECT w.id,'438f96ee-37c4-49bb-a56c-51451f9cb624'::uuid
FROM public.oxygen_workflows w JOIN oxygen_private.provider_states s ON s.workflow_id=w.id
WHERE w.id='b1c11c04-ef5c-4519-963e-a5a9a8d2f951' AND w.environment='staging'
AND s.state->>'bookingReference'='438f96ee-37c4-49bb-a56c-51451f9cb624';
CREATE FUNCTION oxygen_private.activation_trial(p_operation text,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; b oxygen_private.runtime_bindings%ROWTYPE;
 t oxygen_private.activation_trials%ROWTYPE; owner_id uuid; current_ref text; cancelled timestamptz;
 worker_op boolean; payment jsonb;
BEGIN
 IF auth.uid() IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>100000
 OR p_operation NOT IN ('status','enqueue','claim','evidence','finish') THEN RAISE EXCEPTION 'Trial unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM public.oxygen_workflows WHERE id='b1c11c04-ef5c-4519-963e-a5a9a8d2f951' FOR UPDATE;
 IF NOT FOUND OR w.environment<>'staging' THEN RAISE EXCEPTION 'Trial unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM oxygen_private.runtime_bindings WHERE merchant_id=w.merchant_id FOR SHARE;
 SELECT c.user_id,o.cancelled_at INTO owner_id,cancelled FROM public.orders o JOIN public.customers c ON c.id=o.customer_id AND c.merchant_id=o.merchant_id
 WHERE o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id FOR SHARE OF o,c;
 worker_op:=p_operation IN ('claim','evidence','finish');
 IF NOT FOUND OR NOT coalesce(b.enabled,false) OR b.environment<>'staging'
 OR (worker_op AND b.worker_user_id IS DISTINCT FROM auth.uid()) OR (NOT worker_op AND owner_id IS DISTINCT FROM auth.uid())
 THEN RAISE EXCEPTION 'Trial unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM oxygen_private.activation_trials WHERE workflow_id=w.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trial unavailable' USING ERRCODE='42501'; END IF;
 IF p_operation='status' THEN RETURN jsonb_build_object('status',t.status,'result',t.result); END IF;
 SELECT state->>'bookingReference' INTO current_ref FROM oxygen_private.provider_states WHERE workflow_id=w.id;
 IF current_ref IS DISTINCT FROM t.booking_reference::text OR cancelled IS NOT NULL THEN RAISE EXCEPTION 'Trial binding changed' USING ERRCODE='40001'; END IF;
 IF p_operation='enqueue' THEN
  IF t.status<>'ready' THEN RETURN jsonb_build_object('status',t.status); END IF;
  SELECT result INTO payment FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND booking_reference=t.booking_reference AND action='check_status' AND status='succeeded' ORDER BY created_at DESC LIMIT 1;
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
  IF jsonb_array_length(t.evidence)>=6 OR jsonb_typeof(p_payload->'capture') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid evidence'; END IF;
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
CREATE FUNCTION public.oxygen_activation_trial(p_operation text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT oxygen_private.activation_trial(p_operation,p_payload); $$;
REVOKE ALL ON FUNCTION public.oxygen_activation_trial(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_activation_trial(text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
