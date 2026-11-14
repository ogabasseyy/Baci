-- General activation is dormant until separately authorized by an operator.
-- This capability does not modify order payment state, inventory or settlement.
CREATE TABLE oxygen_private.general_activation_policy (
 environment text PRIMARY KEY CHECK (environment IN ('staging','production')),
 enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE oxygen_private.general_activation_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.general_activation_policy FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE oxygen_private.general_activations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workflow_id uuid NOT NULL UNIQUE REFERENCES public.oxygen_workflows(id),
 merchant_id uuid NOT NULL, customer_id uuid NOT NULL, order_id uuid NOT NULL,
 environment text NOT NULL CHECK(environment IN ('staging','production')),
 application_reference uuid NOT NULL, booking_reference uuid NOT NULL,
 amount numeric NOT NULL CHECK(amount > 0),
 status text NOT NULL CHECK(status IN ('executing','indeterminate','activated')),
 ciphertext text CHECK(ciphertext IS NULL OR octet_length(ciphertext) BETWEEN 40 AND 100000),
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
ALTER TABLE oxygen_private.general_activations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.general_activations FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION oxygen_private.general_activation(p_operation text,p_workflow_id uuid,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; b oxygen_private.runtime_bindings%ROWTYPE;
 a oxygen_private.general_activations%ROWTYPE; s jsonb; o record; p record;
BEGIN
 IF auth.uid() IS NULL OR p_operation NOT IN ('claim','finish','reconcile')
 OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>110000 THEN
  RAISE EXCEPTION 'Activation unavailable' USING ERRCODE='42501';
 END IF;
 SELECT id,merchant_id,customer_id,order_id,environment,stage,version INTO w.id,w.merchant_id,w.customer_id,w.order_id,w.environment,w.stage,w.version
 FROM public.oxygen_workflows WHERE id=p_workflow_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Activation unavailable' USING ERRCODE='42501'; END IF;
 SELECT worker_user_id,environment,enabled INTO b.worker_user_id,b.environment,b.enabled FROM oxygen_private.runtime_bindings WHERE merchant_id=w.merchant_id FOR SHARE;
 IF NOT FOUND OR NOT coalesce(b.enabled,false) OR b.worker_user_id IS DISTINCT FROM auth.uid() OR b.environment IS DISTINCT FROM w.environment THEN
  RAISE EXCEPTION 'Activation unavailable' USING ERRCODE='42501';
 END IF;
 SELECT id,workflow_id,merchant_id,customer_id,order_id,environment,application_reference,booking_reference,amount,status,ciphertext,created_at,finished_at INTO a
 FROM oxygen_private.general_activations WHERE workflow_id=w.id FOR UPDATE;
 IF p_operation='finish' THEN
  IF a.id IS NULL OR a.status<>'executing' OR p_payload-ARRAY['attemptId','reference','status','ciphertext']<>'{}'::jsonb
  OR p_payload->>'attemptId' IS DISTINCT FROM a.id::text OR p_payload->>'reference' IS DISTINCT FROM a.booking_reference::text
  OR p_payload->>'status' NOT IN ('activated','indeterminate') OR p_payload->>'status' IS NULL
  OR p_payload->>'ciphertext' IS NULL OR p_payload->>'ciphertext' !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
  OR octet_length(p_payload->>'ciphertext') NOT BETWEEN 40 AND 100000 THEN
   RAISE EXCEPTION 'Activation unavailable' USING ERRCODE='40001';
  END IF;
  UPDATE oxygen_private.general_activations SET status=p_payload->>'status',ciphertext=p_payload->>'ciphertext',finished_at=clock_timestamp() WHERE id=a.id;
  RETURN jsonb_build_object('recorded',true);
 END IF;
 IF p_operation='claim' AND a.id IS NOT NULL THEN RETURN jsonb_build_object('status',a.status,'environment',a.environment); END IF;
 IF p_operation='claim' AND (p_payload<>'{}'::jsonb OR NOT EXISTS(SELECT 1 FROM oxygen_private.general_activation_policy WHERE environment=w.environment AND enabled)) THEN
  RAISE EXCEPTION 'Activation disabled' USING ERRCODE='42501';
 END IF;
 SELECT o1.total,o1.currency,o1.payment_method,o1.cancelled_at,o1.payment_status INTO o FROM public.orders o1
 JOIN public.customers c ON c.id=o1.customer_id AND c.merchant_id=o1.merchant_id
 WHERE o1.id=w.order_id AND o1.merchant_id=w.merchant_id AND o1.customer_id=w.customer_id FOR SHARE OF o1,c;
 IF NOT FOUND OR o.cancelled_at IS NOT NULL OR o.payment_method IS DISTINCT FROM 'oxygen' OR o.currency IS DISTINCT FROM 'NGN'
 OR o.total IS NULL OR o.total<=0 OR o.payment_status IS DISTINCT FROM 'unpaid' THEN
  RAISE EXCEPTION 'Order unavailable' USING ERRCODE='40001';
 END IF;
 SELECT state INTO s FROM oxygen_private.provider_states WHERE workflow_id=w.id FOR UPDATE;
 IF s->>'applicationReference' IS NULL OR s->>'bookingReference' IS NULL
 OR s->'booking'->>'loan_reference' IS DISTINCT FROM s->>'bookingReference'
 OR coalesce(s->'booking'->>'status','') NOT IN ('APPROVED','ACTIVATED')
 OR (s->'booking'->>'product_amount')::numeric IS DISTINCT FROM o.total THEN
  RAISE EXCEPTION 'Activation binding changed' USING ERRCODE='40001';
 END IF;
 IF p_operation='reconcile' THEN
  IF p_payload<>'{}'::jsonb OR a.status IS DISTINCT FROM 'activated' OR a.ciphertext IS NULL
  OR a.merchant_id IS DISTINCT FROM w.merchant_id OR a.customer_id IS DISTINCT FROM w.customer_id
  OR a.order_id IS DISTINCT FROM w.order_id OR a.environment IS DISTINCT FROM w.environment
  OR a.application_reference::text IS DISTINCT FROM s->>'applicationReference'
  OR a.booking_reference::text IS DISTINCT FROM s->>'bookingReference' OR a.amount IS DISTINCT FROM o.total THEN
   RAISE EXCEPTION 'Activation evidence unavailable' USING ERRCODE='40001';
  END IF;
  IF w.stage='activated' AND s->'booking'->>'status'='ACTIVATED' THEN RETURN jsonb_build_object('orderConfirmed',true); END IF;
  UPDATE oxygen_private.provider_states SET state=jsonb_set(s||jsonb_build_object('paymentComplete',true,'setupComplete',true),'{booking,status}','"ACTIVATED"'::jsonb) WHERE workflow_id=w.id;
  UPDATE public.oxygen_workflows SET stage='activated',version=version+1,updated_at=clock_timestamp() WHERE id=w.id;
  RETURN jsonb_build_object('orderConfirmed',true);
 END IF;
 -- Existing trial and general execution may never compete for the same workflow.
 IF w.stage NOT IN ('payment_required','ready_for_activation','reconciliation_required')
 OR (w.stage='reconciliation_required' AND NOT EXISTS(SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w.id AND c.status='indeterminate' AND c.command->>'action'='approve_booking'))
 OR EXISTS(SELECT 1 FROM oxygen_private.activation_trials WHERE workflow_id=w.id)
 OR EXISTS(SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w.id AND (c.status IN ('queued','executing') OR (c.status='indeterminate' AND c.command->>'action'<>'approve_booking')))
 OR EXISTS(SELECT 1 FROM oxygen_private.payment_recovery r WHERE r.workflow_id=w.id AND r.status IN ('queued','executing')) THEN
  RAISE EXCEPTION 'Activation blocked' USING ERRCODE='40001';
 END IF;
 SELECT status,result,expected_version,completed_at INTO p FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND booking_reference::text=s->>'bookingReference' AND action='check_status' ORDER BY created_at DESC,id DESC LIMIT 1;
 IF NOT FOUND OR p.status<>'succeeded' OR p.expected_version IS DISTINCT FROM w.version
 OR p.completed_at IS NULL OR p.completed_at < clock_timestamp()-interval '10 minutes'
 OR p.result->'paymentComplete' IS DISTINCT FROM 'true'::jsonb OR p.result->'setupComplete' IS DISTINCT FROM 'true'::jsonb THEN
  RAISE EXCEPTION 'Payment unconfirmed' USING ERRCODE='40001';
 END IF;
 INSERT INTO oxygen_private.general_activations(workflow_id,merchant_id,customer_id,order_id,environment,application_reference,booking_reference,amount,status)
 VALUES(w.id,w.merchant_id,w.customer_id,w.order_id,w.environment,(s->>'applicationReference')::uuid,(s->>'bookingReference')::uuid,o.total,'executing') RETURNING id INTO a.id;
 RETURN jsonb_build_object('attemptId',a.id,'reference',s->>'bookingReference','environment',w.environment);
END $$;
REVOKE ALL ON FUNCTION oxygen_private.general_activation(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION oxygen_private.general_activation(text,uuid,jsonb) TO authenticated;
CREATE FUNCTION public.oxygen_general_activation(p_operation text,p_workflow_id uuid,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT oxygen_private.general_activation(p_operation,p_workflow_id,p_payload);
$$;
REVOKE ALL ON FUNCTION public.oxygen_general_activation(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_general_activation(text,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
