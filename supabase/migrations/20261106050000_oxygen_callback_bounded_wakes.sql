-- Bound callback generations and select targeted wakes before the scan limit.
CREATE OR REPLACE FUNCTION oxygen_private.callback(p_operation text, p_partner text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid; v_key text; v_hash bytea; v_existing bytea; v_result jsonb; v_environment text;
BEGIN
 SELECT min(b.environment) INTO v_environment FROM oxygen_private.runtime_bindings b
 WHERE b.worker_user_id=auth.uid() AND b.partner_reference=p_partner AND b.enabled
 HAVING count(DISTINCT b.environment)=1;
 IF auth.uid() IS NULL OR v_environment IS NULL THEN
  RAISE EXCEPTION 'Worker unavailable' USING ERRCODE='42501';
 END IF;

 IF p_operation IN ('complete','defer') AND (NOT p_payload ? 'retryKey' OR p_payload->>'retryKey' IS NULL) THEN
  RAISE EXCEPTION 'Callback retry key required' USING ERRCODE='22023';
 END IF;
 IF p_operation='backlog' THEN
  IF p_payload IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'Invalid backlog request' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object(
   'pendingCount',least(count(*),1000),
   'capped',count(*)>1000,
   'oldestAgeSeconds',CASE WHEN count(*)=0 THEN NULL ELSE
    least(2147483647,greatest(0,floor(extract(epoch FROM (clock_timestamp()-min(received_at))))))::integer END
  ) INTO v_result FROM (
   SELECT received_at FROM oxygen_private.callback_inbox
   WHERE partner_reference=p_partner AND environment=v_environment AND status='queued'
   ORDER BY received_at LIMIT 1001
  ) bounded;
  RETURN v_result;
 END IF;
 IF p_operation='accept' THEN
  IF pg_catalog.octet_length(p_payload::text)>262144 OR p_payload->>'kind' NOT IN ('address','selfie','transaction','settlement') THEN RAISE EXCEPTION 'Invalid callback' USING ERRCODE='22023'; END IF;
  IF p_payload->>'kind'='settlement' AND p_payload->>'partnerReference' IS DISTINCT FROM p_partner THEN RAISE EXCEPTION 'Partner mismatch' USING ERRCODE='42501'; END IF;
  v_key:=coalesce(p_payload->>'deduplicationKey','address:'||gen_random_uuid()::text);
  v_hash:=sha256(convert_to(p_payload::text,'UTF8'));
  INSERT INTO oxygen_private.callback_inbox(partner_reference,environment,deduplication_key,payload_hash,event,status)
   VALUES(p_partner,v_environment,v_key,v_hash,p_payload,CASE WHEN p_payload->>'kind'='settlement' THEN 'observed' ELSE 'queued' END)
   ON CONFLICT(partner_reference,environment,deduplication_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
   IF p_payload->>'kind' IN ('address','selfie') AND nullif(p_payload->>'applicationReference','') IS NULL THEN
    UPDATE oxygen_private.callback_inbox SET status='observed',resolution_error='missing_application_reference'
    WHERE id=v_id AND partner_reference=p_partner AND environment=v_environment;
   END IF;
   RETURN jsonb_build_object('result','accepted');
  END IF;
  SELECT payload_hash INTO v_existing FROM oxygen_private.callback_inbox WHERE partner_reference=p_partner AND environment=v_environment AND deduplication_key=v_key;
  IF v_existing<>v_hash AND NOT (
   coalesce(v_existing=sha256(convert_to(oxygen_private.callback_legacy_amount_shape(p_payload)::text,'UTF8')),false)
   OR EXISTS (SELECT 1 FROM oxygen_private.callback_inbox prior
    WHERE prior.partner_reference=p_partner AND prior.environment=v_environment AND prior.deduplication_key=v_key
     AND coalesce(v_hash=sha256(convert_to(oxygen_private.callback_legacy_amount_shape(prior.event)::text,'UTF8')),false))
  ) THEN RAISE EXCEPTION 'Callback conflict' USING ERRCODE='22023'; END IF;
  -- The provider supplies no address event ID: a later identical valid hint
  -- may describe a new review. Requeue completed hints, but coalesce queued
  -- duplicates and never revive unresolved/ambiguous observed callbacks.
  IF p_payload->>'kind' IN ('address','selfie') THEN
   UPDATE oxygen_private.callback_inbox
   SET status='queued', retry_key=gen_random_uuid(), attempts=0,
       received_at=now(), next_attempt_at=now()
   WHERE partner_reference=p_partner AND environment=v_environment
    AND deduplication_key=v_key AND status IN ('queued','done');
   IF nullif(p_payload->>'applicationReference','') IS NOT NULL
    AND cardinality(oxygen_private.callback_candidates(p_partner,p_payload))=1 THEN
    UPDATE oxygen_private.callback_inbox
    SET status='queued',retry_key=gen_random_uuid(),attempts=0,
        received_at=now(),next_attempt_at=now()
    WHERE partner_reference=p_partner AND environment=v_environment
     AND deduplication_key=v_key AND status='observed'
     AND resolution_error IS NULL AND attempts>=5;
   END IF;
  END IF;
  RETURN jsonb_build_object('result','duplicate','wakeNeeded',EXISTS(
   SELECT 1 FROM oxygen_private.callback_inbox i
   WHERE i.partner_reference=p_partner AND i.environment=v_environment AND i.status='queued'
    AND i.event->>'kind'=p_payload->>'kind'
    AND (p_payload->>'kind' NOT IN ('address','selfie') OR i.event->>'applicationReference'=p_payload->>'applicationReference')
  ));
 ELSIF p_operation='pending' THEN

  -- Do not attribute phone-only events to a possibly unrelated application.
  UPDATE oxygen_private.callback_inbox i SET status='observed',resolution_error='missing_application_reference'
   WHERE i.id IN (SELECT id FROM oxygen_private.callback_inbox
    WHERE partner_reference=p_partner AND environment=v_environment AND status='queued'
      AND event->>'kind' IN ('address','selfie') AND nullif(event->>'applicationReference','') IS NULL
    ORDER BY next_attempt_at,received_at LIMIT 100);
  -- Legacy phone-only notifications must never fan out across applications.
  UPDATE oxygen_private.callback_inbox i
   SET status='observed',resolution_error='ambiguous_address'
   WHERE i.id IN (SELECT candidate.id FROM (
     SELECT id,event FROM oxygen_private.callback_inbox
     WHERE partner_reference=p_partner AND environment=v_environment AND status='queued' AND event->>'kind' IN ('address','selfie')
     ORDER BY next_attempt_at,received_at LIMIT 100
    ) candidate WHERE pg_catalog.cardinality(oxygen_private.callback_candidates(p_partner,candidate.event))>1);
  -- Rotate currently unmatched rows so they remain recoverable without starving later callbacks.
  UPDATE oxygen_private.callback_inbox i SET next_attempt_at=now()+interval '1 minute'
   WHERE i.id IN (SELECT candidate.id FROM (
    SELECT id,event FROM oxygen_private.callback_inbox
    WHERE partner_reference=p_partner AND environment=v_environment AND status='queued' AND next_attempt_at<=now()
    ORDER BY next_attempt_at,received_at LIMIT 100
   ) candidate WHERE pg_catalog.cardinality(oxygen_private.callback_candidates(p_partner,candidate.event))=0);
  SELECT coalesce(jsonb_agg(item ORDER BY due,received_at,id),'[]'::jsonb) INTO v_result FROM (
   SELECT jsonb_build_object('id',i.id,'retryKey',i.retry_key,'kind',i.event->>'kind',
    'workflowIds',to_jsonb(oxygen_private.callback_candidates(p_partner,i.event))) AS item,
    i.next_attempt_at AS due,i.received_at,i.id
   FROM (SELECT id,retry_key,event,received_at,next_attempt_at FROM oxygen_private.callback_inbox
    WHERE partner_reference=p_partner AND environment=v_environment AND status='queued' AND next_attempt_at<=now()
    AND (NOT p_payload ? 'kind' OR event->>'kind'=p_payload->>'kind')
    AND (NOT p_payload ? 'applicationReference' OR event->>'applicationReference'=p_payload->>'applicationReference')
    ORDER BY next_attempt_at,received_at LIMIT 100) i
   WHERE true
    AND pg_catalog.cardinality(oxygen_private.callback_candidates(p_partner,i.event))>0
   ORDER BY i.next_attempt_at,i.received_at,i.id LIMIT 10
  ) jobs;
  RETURN v_result;
 ELSIF p_operation='defer' THEN
  UPDATE oxygen_private.callback_inbox SET attempts=attempts+1, retry_key=gen_random_uuid(), next_attempt_at=now()+interval '1 minute',
   status=CASE WHEN attempts+1>=5 THEN 'observed' ELSE 'queued' END
   WHERE partner_reference=p_partner AND environment=v_environment AND id=(p_payload->>'id')::uuid AND status='queued'
    AND retry_key=(p_payload->>'retryKey')::uuid;
  RETURN jsonb_build_object('recorded',true);
 ELSIF p_operation='complete' THEN
  UPDATE oxygen_private.callback_inbox SET status='done' WHERE partner_reference=p_partner AND environment=v_environment AND id=(p_payload->>'id')::uuid AND status='queued'
    AND retry_key=(p_payload->>'retryKey')::uuid;
  RETURN jsonb_build_object('recorded',true);
 END IF;
 RAISE EXCEPTION 'Unsupported callback operation' USING ERRCODE='22023';
END $function$
;

