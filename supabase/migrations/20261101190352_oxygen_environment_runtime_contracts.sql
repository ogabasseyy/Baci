-- Environment derives from an owner-provisioned merchant binding, never from input.
ALTER TABLE oxygen_private.runtime_bindings DROP CONSTRAINT runtime_bindings_environment_check;
ALTER TABLE oxygen_private.runtime_bindings ADD CONSTRAINT runtime_bindings_environment_check CHECK (environment IN ('staging','production'));
ALTER TABLE oxygen_private.callback_inbox ADD COLUMN environment text NOT NULL DEFAULT 'staging' CHECK (environment IN ('staging','production'));
ALTER TABLE oxygen_private.callback_inbox DROP CONSTRAINT callback_inbox_partner_reference_deduplication_key_key;
ALTER TABLE oxygen_private.callback_inbox ADD UNIQUE(partner_reference,environment,deduplication_key);

-- Preserve all earlier runtime fixes, and reject mismatched workflow/binding before execution.
DO $$ DECLARE definition text; needle text := 'IF NOT coalesce(b.enabled,false) OR b.environment<>''staging'' OR w.environment<>''staging'' THEN';
BEGIN
 definition:=pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen runtime definition'; END IF;
 definition:=replace(definition,needle,'IF NOT coalesce(b.enabled,false) OR b.environment IS DISTINCT FROM w.environment THEN');
 needle := 'coalesce(b.enabled,false) AND v_order.payment_status=''' || 'unpaid' || '''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen runtime status'; END IF;
 definition:=replace(definition,needle,'coalesce(b.enabled,false) AND b.environment=w.environment AND v_order.payment_status=''unpaid''');
 EXECUTE definition;
END $$;

DROP POLICY oxygen_draft_insert ON public.oxygen_form_drafts;
CREATE POLICY oxygen_draft_insert ON public.oxygen_form_drafts FOR INSERT TO authenticated
WITH CHECK (user_id=(SELECT auth.uid()) AND version=1 AND EXISTS
 (SELECT 1 FROM public.oxygen_workflows w WHERE w.id=workflow_id AND w.stage='application_required'));
DROP POLICY oxygen_draft_update ON public.oxygen_form_drafts;
CREATE POLICY oxygen_draft_update ON public.oxygen_form_drafts FOR UPDATE TO authenticated
USING (user_id=(SELECT auth.uid()) AND EXISTS
 (SELECT 1 FROM public.oxygen_workflows w WHERE w.id=workflow_id AND w.stage='application_required'))
WITH CHECK (user_id=(SELECT auth.uid()) AND EXISTS
 (SELECT 1 FROM public.oxygen_workflows w WHERE w.id=workflow_id AND w.stage='application_required'));

CREATE OR REPLACE FUNCTION oxygen_private.start_workflow(p_order_id uuid,p_channel text DEFAULT 'web')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order record; v_row public.oxygen_workflows%ROWTYPE; v_environment text;
BEGIN
  SELECT o.id, o.merchant_id, o.customer_id, o.total, o.currency, o.payment_status, o.cancelled_at INTO v_order FROM public.orders o JOIN public.customers c
    ON c.id = o.customer_id AND c.merchant_id = o.merchant_id
    WHERE o.id = p_order_id AND c.user_id = auth.uid() FOR SHARE OF o, c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501'; END IF;
  IF p_channel NOT IN ('web','mobile','chat') OR p_channel IS NULL THEN
    RAISE EXCEPTION 'Invalid channel' USING ERRCODE = '22023';
  END IF;
  -- Resume existing liability even after payment; only NEW drafts need unpaid orders.
  SELECT id, order_id, merchant_id, customer_id, created_channel, environment, stage, version, created_at, updated_at
    INTO v_row FROM public.oxygen_workflows WHERE order_id = p_order_id
    AND customer_id = v_order.customer_id AND merchant_id = v_order.merchant_id;
  IF FOUND THEN
    RETURN jsonb_build_object('id',v_row.id,'order_id',v_row.order_id,'stage',v_row.stage,
      'version',v_row.version,'environment',v_row.environment,
      'created_at',v_row.created_at,'updated_at',v_row.updated_at);
  END IF;
  IF v_order.total <= 0 OR v_order.currency IS DISTINCT FROM 'NGN'
    OR v_order.payment_status <> 'unpaid' OR v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE = '22023';
  END IF;
  SELECT b.environment INTO v_environment FROM oxygen_private.runtime_bindings b
    WHERE b.merchant_id=v_order.merchant_id AND b.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider connection unavailable' USING ERRCODE='55000'; END IF;
  INSERT INTO public.oxygen_workflows(order_id,merchant_id,customer_id,created_channel,environment)
    VALUES (v_order.id,v_order.merchant_id,v_order.customer_id,p_channel,v_environment)
    ON CONFLICT (order_id) DO NOTHING;
  SELECT id, order_id, merchant_id, customer_id, created_channel, environment, stage, version, created_at, updated_at
    INTO STRICT v_row FROM public.oxygen_workflows WHERE order_id = p_order_id AND customer_id = v_order.customer_id AND merchant_id = v_order.merchant_id;
  RETURN jsonb_build_object('id',v_row.id,'order_id',v_row.order_id,'stage',v_row.stage,
    'version',v_row.version,'environment',v_row.environment,
    'created_at',v_row.created_at,'updated_at',v_row.updated_at);
END $$;

CREATE OR REPLACE FUNCTION oxygen_private.callback_candidates(p_partner text,p_event jsonb)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(array_agg(candidate.workflow_id ORDER BY candidate.workflow_id),ARRAY[]::uuid[])
 FROM (
  SELECT s.workflow_id FROM oxygen_private.provider_states s
  JOIN public.oxygen_workflows w ON w.id=s.workflow_id
  WHERE EXISTS (
   SELECT 1 FROM oxygen_private.runtime_bindings b
   WHERE b.merchant_id=w.merchant_id AND b.partner_reference=p_partner
    AND b.worker_user_id=auth.uid() AND b.environment=w.environment AND b.enabled
  ) AND (
   (p_event->>'kind'='transaction' AND s.state->>'bookingReference'=p_event->>'bookedLoanReference') OR
   (p_event->>'kind'='address'
    AND regexp_replace(regexp_replace(s.state->>'phone','[^0-9]','','g'),'^0','234')=
        regexp_replace(regexp_replace(p_event->>'phoneNumber','[^0-9]','','g'),'^0','234')
    AND (NOT p_event ? 'applicationReference' OR s.state->>'applicationReference'=p_event->>'applicationReference'))
  )
 ) candidate;
$$;
REVOKE ALL ON FUNCTION oxygen_private.callback_candidates(text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION oxygen_private.callback(p_operation text,p_partner text,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_key text; v_hash bytea; v_existing bytea; v_result jsonb; v_environment text;
BEGIN
 SELECT min(b.environment) INTO v_environment FROM oxygen_private.runtime_bindings b
 WHERE b.worker_user_id=auth.uid() AND b.partner_reference=p_partner AND b.enabled
 HAVING count(DISTINCT b.environment)=1;
 IF auth.uid() IS NULL OR v_environment IS NULL THEN
  RAISE EXCEPTION 'Worker unavailable' USING ERRCODE='42501';
 END IF;
 IF p_operation='accept' THEN
  IF pg_catalog.octet_length(p_payload::text)>262144 OR p_payload->>'kind' NOT IN ('address','transaction','settlement') THEN RAISE EXCEPTION 'Invalid callback' USING ERRCODE='22023'; END IF;
  IF p_payload->>'kind'='settlement' AND p_payload->>'partnerReference' IS DISTINCT FROM p_partner THEN RAISE EXCEPTION 'Partner mismatch' USING ERRCODE='42501'; END IF;
  v_key:=coalesce(p_payload->>'deduplicationKey','address:'||gen_random_uuid()::text);
  v_hash:=sha256(convert_to(p_payload::text,'UTF8'));
  INSERT INTO oxygen_private.callback_inbox(partner_reference,environment,deduplication_key,payload_hash,event,status)
   VALUES(p_partner,v_environment,v_key,v_hash,p_payload,CASE WHEN p_payload->>'kind'='settlement' THEN 'observed' ELSE 'queued' END)
   ON CONFLICT(partner_reference,environment,deduplication_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('result','accepted'); END IF;
  SELECT payload_hash INTO v_existing FROM oxygen_private.callback_inbox WHERE partner_reference=p_partner AND environment=v_environment AND deduplication_key=v_key;
  IF v_existing<>v_hash THEN RAISE EXCEPTION 'Callback conflict' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('result','duplicate');
 ELSIF p_operation='pending' THEN
  -- Legacy phone-only notifications must never fan out across applications.
  UPDATE oxygen_private.callback_inbox i
   SET status='observed',resolution_error='ambiguous_address'
   WHERE i.id IN (SELECT candidate.id FROM (
     SELECT id,event FROM oxygen_private.callback_inbox
     WHERE partner_reference=p_partner AND environment=v_environment AND status='queued' AND event->>'kind'='address'
     ORDER BY next_attempt_at,received_at LIMIT 100
    ) candidate WHERE pg_catalog.cardinality(oxygen_private.callback_candidates(p_partner,candidate.event))>1);
  -- Rotate currently unmatched rows so they remain recoverable without starving later callbacks.
  UPDATE oxygen_private.callback_inbox i SET next_attempt_at=now()+interval '1 minute'
   WHERE i.id IN (SELECT candidate.id FROM (
    SELECT id,event FROM oxygen_private.callback_inbox
    WHERE partner_reference=p_partner AND environment=v_environment AND status='queued' AND next_attempt_at<=now()
    ORDER BY next_attempt_at,received_at LIMIT 100
   ) candidate WHERE pg_catalog.cardinality(oxygen_private.callback_candidates(p_partner,candidate.event))=0);
  SELECT coalesce(jsonb_agg(item),'[]'::jsonb) INTO v_result FROM (
   SELECT jsonb_build_object('id',i.id,'retryKey',i.retry_key,'kind',i.event->>'kind',
    'workflowIds',to_jsonb(oxygen_private.callback_candidates(p_partner,i.event))) AS item
   FROM (SELECT id,retry_key,event,received_at FROM oxygen_private.callback_inbox
    WHERE partner_reference=p_partner AND environment=v_environment AND status='queued' AND next_attempt_at<=now()
    ORDER BY next_attempt_at,received_at LIMIT 100) i
   WHERE true
    AND (NOT p_payload ? 'kind' OR i.event->>'kind'=p_payload->>'kind')
    AND (NOT p_payload ? 'applicationReference' OR i.event->>'applicationReference'=p_payload->>'applicationReference')
    AND pg_catalog.cardinality(oxygen_private.callback_candidates(p_partner,i.event))>0
   ORDER BY i.received_at LIMIT 10
  ) jobs;
  RETURN v_result;
 ELSIF p_operation='defer' THEN
  UPDATE oxygen_private.callback_inbox SET attempts=attempts+1, retry_key=gen_random_uuid(), next_attempt_at=now()+interval '1 minute',
   status='queued'
   WHERE partner_reference=p_partner AND environment=v_environment AND id=(p_payload->>'id')::uuid AND status='queued';
  RETURN jsonb_build_object('recorded',true);
 ELSIF p_operation='complete' THEN
  UPDATE oxygen_private.callback_inbox SET status='done' WHERE partner_reference=p_partner AND environment=v_environment AND id=(p_payload->>'id')::uuid AND status='queued';
  RETURN jsonb_build_object('recorded',true);
 END IF;
 RAISE EXCEPTION 'Unsupported callback operation' USING ERRCODE='22023';
END $$;

NOTIFY pgrst, 'reload schema';
