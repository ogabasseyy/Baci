-- Each bounded read retry owns a fresh durable command; unknown mutations are never retried.
ALTER TABLE oxygen_private.callback_inbox ADD COLUMN retry_key uuid NOT NULL DEFAULT gen_random_uuid();
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
  SELECT coalesce(jsonb_agg(item),'[]'::jsonb) INTO v_result FROM ( SELECT item FROM (
   SELECT jsonb_build_object('id',i.id,'retryKey',i.retry_key,'kind',i.event->>'kind','workflowIds',coalesce((
    SELECT jsonb_agg(s.workflow_id) FROM oxygen_private.provider_states s
    JOIN public.oxygen_workflows w ON w.id=s.workflow_id
    JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id
    WHERE b.partner_reference=p_partner AND b.worker_user_id=auth.uid() AND b.enabled AND w.environment='staging'
    AND ((i.event->>'kind'='transaction' AND s.state->>'bookingReference'=i.event->>'bookedLoanReference')
     OR (i.event->>'kind'='address' AND s.state->>'phone'=regexp_replace(regexp_replace(i.event->>'phoneNumber','[^0-9]','','g'),'^0','234')))
   ),'[]'::jsonb)) AS item,i.received_at FROM oxygen_private.callback_inbox i
   WHERE i.partner_reference=p_partner AND i.status='queued' AND i.next_attempt_at<=now()
  ) candidates WHERE jsonb_array_length(item->'workflowIds')>0 ORDER BY received_at LIMIT 10 ) jobs;
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
