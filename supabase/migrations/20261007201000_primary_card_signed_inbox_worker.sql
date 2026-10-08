BEGIN;
CREATE TABLE piggyvest_primary_card.signed_custody_observations (
  integration_id uuid NOT NULL REFERENCES piggyvest_primary_card.settings(integration_id),
  event_id text NOT NULL,
  body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
  operation_id uuid NOT NULL REFERENCES piggyvest_primary_card.settlements(operation_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id,body_digest)
);
CREATE INDEX primary_card_observation_operation_idx ON piggyvest_primary_card.signed_custody_observations(operation_id);
ALTER TABLE piggyvest_primary_card.signed_custody_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_card_observation_deny ON piggyvest_primary_card.signed_custody_observations AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON piggyvest_primary_card.signed_custody_observations FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_evidence,primary_card_transfer_worker,primary_card_custody_evidence;
ALTER FUNCTION piggyvest_primary_card.settle_custody(uuid,text,jsonb) RENAME TO settle_custody_ledger_impl;
REVOKE ALL ON FUNCTION piggyvest_primary_card.settle_custody_ledger_impl(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,primary_card_custody_evidence;
CREATE FUNCTION piggyvest_primary_card.settle_custody(target_integration_id uuid, environment text, proof jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE outcome text;
BEGIN
  outcome := piggyvest_primary_card.settle_custody_ledger_impl($1,$2,$3);
  IF outcome IN ('completed','duplicate') THEN
    INSERT INTO piggyvest_primary_card.signed_custody_observations(integration_id,event_id,body_digest,operation_id)
      VALUES($1,proof->>'eventId',proof->>'bodyDigest',(proof->>'operationId')::uuid) ON CONFLICT(integration_id,event_id,body_digest) DO NOTHING;
    IF EXISTS(SELECT 1 FROM piggyvest_primary_card.signed_custody_observations WHERE integration_id=$1 AND event_id=proof->>'eventId'
      AND body_digest=proof->>'bodyDigest' AND operation_id<>(proof->>'operationId')::uuid) THEN RAISE EXCEPTION 'signed observation conflict' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.settle_custody(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_evidence,primary_card_transfer_worker;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.settle_custody(uuid,text,jsonb) TO primary_card_custody_evidence;
CREATE FUNCTION piggyvest_primary_card.claim_signed_inbox(target_integration uuid, environment text, capability jsonb, batch_size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE output jsonb;
BEGIN
  IF NOT piggyvest_primary_card.inbox_ready($1,$2,$3) THEN RAISE EXCEPTION 'signed inbox capability unavailable' USING ERRCODE='42501'; END IF;
  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid inbox batch' USING ERRCODE='22023'; END IF;
  UPDATE piggyvest_primary_card.signed_inbox SET state='blocked',reason='attempts_exhausted',claim_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE integration_id=$1 AND attempts=50 AND (state='pending' OR (state='processing' AND lease_until<clock_timestamp()));
  WITH due AS (
    SELECT event_id FROM piggyvest_primary_card.signed_inbox WHERE integration_id=$1 AND attempts<50
      AND ((state='pending' AND available_at<=clock_timestamp()) OR (state='processing' AND lease_until<clock_timestamp()))
      ORDER BY available_at,event_id FOR UPDATE SKIP LOCKED LIMIT batch_size
  ), claimed AS (
    UPDATE piggyvest_primary_card.signed_inbox stored SET state='processing',claim_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1,updated_at=clock_timestamp()
      FROM due WHERE stored.integration_id=$1 AND stored.event_id=due.event_id
      RETURNING stored.event_id,stored.claim_token,stored.payload,stored.signature,stored.attempts
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('eventId',event_id,'token',claim_token,'rawHex',encode(payload,'hex'),'signature',signature,'attempts',attempts)),'[]'::jsonb) INTO output FROM claimed;
  RETURN output;
END $$;
CREATE FUNCTION piggyvest_primary_card.resolve_signed_reference(target_integration uuid, environment text, capability jsonb, reference text, source_wallet text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation_id uuid;
BEGIN
  IF NOT piggyvest_primary_card.inbox_ready($1,$2,$3) THEN RAISE EXCEPTION 'signed inbox capability unavailable' USING ERRCODE='42501'; END IF;
  IF reference IS NULL OR reference !~ '^pvb-primary-transfer-[0-9a-f-]{36}$' OR source_wallet IS NULL THEN RETURN NULL; END IF;
  SELECT operation.id INTO operation_id FROM piggyvest_primary_card.operations operation
    JOIN piggyvest_primary_card.reservations reservation ON reservation.operation_id=operation.id
    JOIN piggyvest_primary_card.transfer_outbox outbox ON outbox.operation_id=operation.id
    JOIN piggyvest_primary_card.treasury_policy policy ON policy.integration_id=operation.integration_id
    WHERE operation.integration_id=$1 AND operation.environment=$2 AND operation.state IN ('custody_pending','completed')
      AND reservation.transfer_reference=$4 AND reservation.source_wallet_id=$5 AND policy.source_wallet_id=$5 AND policy.treasury_binding_id=reservation.treasury_binding_id
      AND outbox.state IN ('dispatching','submitted','unknown','completed') FOR SHARE;
  RETURN operation_id;
END $$;
CREATE FUNCTION piggyvest_primary_card.finish_signed_inbox(target_integration uuid, environment text, capability jsonb, signed_event text, token uuid, outcome text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT piggyvest_primary_card.inbox_ready($1,$2,$3) THEN RAISE EXCEPTION 'signed inbox capability unavailable' USING ERRCODE='42501'; END IF;
  IF outcome IS NULL OR outcome NOT IN ('completed','duplicate','deferred','conflict','io_retry') THEN RAISE EXCEPTION 'invalid inbox resolution' USING ERRCODE='22023'; END IF;
  UPDATE piggyvest_primary_card.signed_inbox SET state=CASE WHEN outcome IN ('completed','duplicate') THEN 'processed' WHEN outcome='conflict' OR attempts=50 THEN 'blocked' ELSE 'pending' END,
    reason=CASE WHEN outcome IN ('completed','duplicate') THEN NULL WHEN outcome='conflict' THEN 'proof_conflict' WHEN attempts=50 THEN 'attempts_exhausted' WHEN outcome='io_retry' THEN 'io_retry' ELSE 'evidence_deferred' END,
    claim_token=NULL,lease_until=NULL,available_at=clock_timestamp()+make_interval(secs=>LEAST(300,attempts*5)),updated_at=clock_timestamp()
    WHERE integration_id=$1 AND event_id=$4 AND state='processing' AND claim_token=token AND lease_until>clock_timestamp()
      AND (outcome NOT IN ('completed','duplicate') OR EXISTS(
        SELECT 1 FROM piggyvest_primary_card.signed_custody_observations observation
        WHERE observation.integration_id=$1 AND observation.body_digest=signed_inbox.body_digest AND observation.event_id=signed_inbox.event_id
      ));
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.claim_signed_inbox(uuid,text,jsonb,integer),piggyvest_primary_card.resolve_signed_reference(uuid,text,jsonb,text,text),piggyvest_primary_card.finish_signed_inbox(uuid,text,jsonb,text,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_evidence,primary_card_transfer_worker;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.claim_signed_inbox(uuid,text,jsonb,integer),piggyvest_primary_card.resolve_signed_reference(uuid,text,jsonb,text,text),piggyvest_primary_card.finish_signed_inbox(uuid,text,jsonb,text,uuid,text) TO primary_card_custody_evidence;
COMMIT;
