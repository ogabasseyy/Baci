-- Preserve exact address application correlation. No financial actions or broad grants.
ALTER TABLE oxygen_private.callback_inbox ADD COLUMN resolution_error text
 CHECK (resolution_error IS NULL OR resolution_error='ambiguous_address');

CREATE FUNCTION oxygen_private.callback_candidates(p_partner text,p_event jsonb)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(array_agg(candidate.workflow_id ORDER BY candidate.workflow_id),ARRAY[]::uuid[])
 FROM (
  SELECT s.workflow_id FROM oxygen_private.provider_states s
  JOIN public.oxygen_workflows w ON w.id=s.workflow_id
  WHERE w.environment='staging' AND EXISTS (
   SELECT 1 FROM oxygen_private.runtime_bindings b
   WHERE b.merchant_id=w.merchant_id AND b.partner_reference=p_partner
    AND b.worker_user_id=auth.uid() AND b.environment='staging' AND b.enabled
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
DECLARE v_id uuid; v_key text; v_hash bytea; v_existing bytea; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM oxygen_private.runtime_bindings b
  WHERE b.worker_user_id=auth.uid() AND b.partner_reference=p_partner AND b.environment='staging' AND b.enabled) THEN
  RAISE EXCEPTION 'Worker unavailable' USING ERRCODE='42501';
 END IF;
 IF p_operation='accept' THEN
  IF pg_catalog.octet_length(p_payload::text)>262144 OR p_payload->>'kind' NOT IN ('address','transaction','settlement') THEN RAISE EXCEPTION 'Invalid callback' USING ERRCODE='22023'; END IF;
  IF p_payload->>'kind'='settlement' AND p_payload->>'partnerReference' IS DISTINCT FROM p_partner THEN RAISE EXCEPTION 'Partner mismatch' USING ERRCODE='42501'; END IF;
  v_key:=coalesce(p_payload->>'deduplicationKey','address:'||gen_random_uuid()::text);
  v_hash:=sha256(convert_to(p_payload::text,'UTF8'));
  INSERT INTO oxygen_private.callback_inbox(partner_reference,deduplication_key,payload_hash,event,status)
   VALUES(p_partner,v_key,v_hash,p_payload,CASE WHEN p_payload->>'kind'='settlement' THEN 'observed' ELSE 'queued' END)
   ON CONFLICT(partner_reference,deduplication_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('result','accepted'); END IF;
  SELECT payload_hash INTO v_existing FROM oxygen_private.callback_inbox WHERE partner_reference=p_partner AND deduplication_key=v_key;
  IF v_existing<>v_hash THEN RAISE EXCEPTION 'Callback conflict' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('result','duplicate');
 ELSIF p_operation='pending' THEN
  -- Legacy phone-only notifications must never fan out across applications.
  UPDATE oxygen_private.callback_inbox i
   SET status='observed',resolution_error='ambiguous_address'
   WHERE i.partner_reference=p_partner AND i.status='queued' AND i.event->>'kind'='address'
    AND pg_catalog.cardinality(oxygen_private.callback_candidates(p_partner,i.event))>1;
  SELECT coalesce(jsonb_agg(item),'[]'::jsonb) INTO v_result FROM (
   SELECT jsonb_build_object('id',i.id,'retryKey',i.retry_key,'kind',i.event->>'kind',
    'workflowIds',to_jsonb(oxygen_private.callback_candidates(p_partner,i.event))) AS item
   FROM oxygen_private.callback_inbox i
   WHERE i.partner_reference=p_partner AND i.status='queued' AND i.next_attempt_at<=now()
    AND (NOT p_payload ? 'kind' OR i.event->>'kind'=p_payload->>'kind')
    AND (NOT p_payload ? 'applicationReference' OR i.event->>'applicationReference'=p_payload->>'applicationReference')
    AND pg_catalog.cardinality(oxygen_private.callback_candidates(p_partner,i.event))>0
   ORDER BY i.received_at LIMIT 10
  ) jobs;
  RETURN v_result;
 ELSIF p_operation='defer' THEN
  UPDATE oxygen_private.callback_inbox SET attempts=attempts+1, retry_key=gen_random_uuid(), next_attempt_at=now()+interval '1 minute',
   status=CASE WHEN attempts+1>=5 THEN 'observed' ELSE 'queued' END
   WHERE partner_reference=p_partner AND id=(p_payload->>'id')::uuid AND status='queued';
  RETURN jsonb_build_object('recorded',true);
 ELSIF p_operation='complete' THEN
  UPDATE oxygen_private.callback_inbox SET status='done' WHERE partner_reference=p_partner AND id=(p_payload->>'id')::uuid AND status='queued';
  RETURN jsonb_build_object('recorded',true);
 END IF;
 RAISE EXCEPTION 'Unsupported callback operation' USING ERRCODE='22023';
END $$;
