BEGIN;
ALTER FUNCTION piggyvest_primary.apply_paid_interest(uuid,text,jsonb) RENAME TO apply_paid_interest_before_inbox;
REVOKE ALL ON FUNCTION piggyvest_primary.apply_paid_interest_before_inbox(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,piggyvest_primary_evidence;
CREATE FUNCTION piggyvest_primary.apply_paid_interest(p_integration uuid,p_environment text,p_proof jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE outcome text; queued piggyvest_primary.paid_interest_inbox%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary.assert_paid_interest_worker(p_integration,p_environment);
  SELECT * INTO queued FROM piggyvest_primary.paid_interest_inbox
    WHERE integration_id=p_integration AND event_id=p_proof->>'eventId' FOR UPDATE;
  IF FOUND THEN
    IF queued.state='quarantined' OR queued.body_digest IS DISTINCT FROM p_proof->>'bodyDigest' THEN RETURN 'conflict'; END IF;
    IF queued.state='pending' OR (queued.state='processing' AND queued.lease_until<=clock_timestamp()) THEN RETURN 'prerequisite'; END IF;
  END IF;
  outcome:=piggyvest_primary.apply_paid_interest_before_inbox(p_integration,p_environment,p_proof);
  IF outcome IN ('credited','duplicate') THEN
    INSERT INTO piggyvest_primary.paid_interest_inbox_observations(integration_id,event_id,body_digest,payout_id)
      VALUES(p_integration,p_proof->>'eventId',p_proof->>'bodyDigest',p_proof->>'payoutId') ON CONFLICT DO NOTHING;
    IF EXISTS(SELECT 1 FROM piggyvest_primary.paid_interest_inbox_observations WHERE integration_id=p_integration
      AND event_id=p_proof->>'eventId' AND body_digest=p_proof->>'bodyDigest' AND payout_id<>p_proof->>'payoutId') THEN
      RAISE EXCEPTION 'interest inbox financial observation conflict' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN outcome;
END $$;
CREATE FUNCTION piggyvest_primary.claim_paid_interest_inbox(p_integration uuid,p_environment text,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE output jsonb; batch integer;
BEGIN
  PERFORM piggyvest_primary.assert_paid_interest_worker(p_integration,p_environment);
  IF p_command IS NULL OR p_command<>jsonb_build_object('batchSize',p_command->'batchSize')
    OR jsonb_typeof(p_command->'batchSize') IS DISTINCT FROM 'number' OR p_command->>'batchSize' !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'invalid interest inbox batch' USING ERRCODE='22023';
  END IF;
  batch:=(p_command->>'batchSize')::integer;
  IF batch NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid interest inbox batch' USING ERRCODE='22023'; END IF;
  WITH due AS (
    SELECT event_id FROM piggyvest_primary.paid_interest_inbox WHERE integration_id=p_integration
      AND ((state='pending' AND available_at<=clock_timestamp()) OR (state='processing' AND lease_until<clock_timestamp()))
      ORDER BY available_at,event_id FOR UPDATE SKIP LOCKED LIMIT batch
  ), claimed AS (
    UPDATE piggyvest_primary.paid_interest_inbox stored SET state='processing',claim_token=gen_random_uuid(),
      lease_until=clock_timestamp()+interval '90 seconds',attempts=least(50,attempts+1),updated_at=clock_timestamp()
    FROM due WHERE stored.integration_id=p_integration AND stored.event_id=due.event_id
    RETURNING stored.event_id,stored.claim_token,stored.payload,stored.signature,stored.body_digest,stored.attempts
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('eventId',event_id,'token',claim_token,'rawHex',encode(payload,'hex'),
    'signature',signature,'bodyDigest',body_digest,'attempts',attempts)),'[]'::jsonb) INTO output FROM claimed;
  RETURN output;
END $$;
CREATE FUNCTION piggyvest_primary.finish_paid_interest_inbox(p_integration uuid,p_environment text,p_command jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE outcome text;
BEGIN
  PERFORM piggyvest_primary.assert_paid_interest_worker(p_integration,p_environment);
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid interest inbox finish' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_command))<>3 OR NOT p_command ?& ARRAY['eventId','token','outcome']
    OR jsonb_typeof(p_command->'eventId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_command->'token') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'invalid interest inbox finish' USING ERRCODE='22023';
  END IF;
  outcome:=p_command->>'outcome';
  IF outcome IS NULL OR outcome NOT IN ('credited','duplicate','prerequisite','conflict','io_retry','invalid_receipt') THEN
    RAISE EXCEPTION 'invalid interest inbox outcome' USING ERRCODE='22023';
  END IF;
  UPDATE piggyvest_primary.paid_interest_inbox inbox SET
    state=CASE WHEN outcome IN ('credited','duplicate') THEN 'processed' WHEN outcome IN ('conflict','invalid_receipt') THEN 'quarantined' ELSE 'pending' END,
    reason=CASE WHEN outcome IN ('credited','duplicate') THEN NULL WHEN outcome='conflict' THEN 'proof_conflict' ELSE outcome END,
    claim_token=NULL,lease_until=NULL,available_at=clock_timestamp()+make_interval(secs=>least(900,attempts*30)),updated_at=clock_timestamp()
  WHERE inbox.integration_id=p_integration AND inbox.event_id=p_command->>'eventId' AND inbox.state='processing'
    AND inbox.claim_token=(p_command->>'token')::uuid AND inbox.lease_until>clock_timestamp()
    AND (outcome NOT IN ('credited','duplicate') OR EXISTS(SELECT 1 FROM piggyvest_primary.paid_interest_inbox_observations observation
      WHERE observation.integration_id=p_integration AND observation.event_id=inbox.event_id AND observation.body_digest=inbox.body_digest
        AND observation.payout_id=(convert_from(inbox.payload,'UTF8')::jsonb)->'eventData'->>'id'));
  RETURN FOUND;
END $$;
CREATE FUNCTION piggyvest_primary.paid_interest_inbox_readiness(p_integration uuid,p_environment text,p_command jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_paid_interest_worker(p_integration,p_environment);
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR p_command IS DISTINCT FROM jsonb_build_object('businessId',p_command->'businessId')
    OR jsonb_typeof(p_command->'businessId') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'invalid interest inbox readiness' USING ERRCODE='22023';
  END IF;
  RETURN EXISTS(SELECT 1 FROM piggyvest_primary.integrations WHERE id=p_integration AND business_id=p_command->>'businessId');
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.apply_paid_interest(uuid,text,jsonb),piggyvest_primary.claim_paid_interest_inbox(uuid,text,jsonb),
  piggyvest_primary.finish_paid_interest_inbox(uuid,text,jsonb),piggyvest_primary.paid_interest_inbox_readiness(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.apply_paid_interest(uuid,text,jsonb),piggyvest_primary.claim_paid_interest_inbox(uuid,text,jsonb),
  piggyvest_primary.finish_paid_interest_inbox(uuid,text,jsonb),piggyvest_primary.paid_interest_inbox_readiness(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;
