BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.claim_signed_inbox(target_integration uuid, environment text, capability jsonb, batch_size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE output jsonb;
BEGIN
  IF NOT piggyvest_primary_card.inbox_ready($1,$2,$3) THEN RAISE EXCEPTION 'signed inbox capability unavailable' USING ERRCODE='42501'; END IF;
  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid inbox batch' USING ERRCODE='22023'; END IF;
  UPDATE piggyvest_primary_card.signed_inbox SET state='blocked',reason='attempts_exhausted',claim_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE integration_id=$1 AND attempts=50 AND (state='pending' OR (state='processing' AND lease_until<clock_timestamp()))
    AND reason IS DISTINCT FROM 'evidence_deferred' AND reason IS DISTINCT FROM 'io_retry';
  WITH due AS (
    SELECT event_id FROM piggyvest_primary_card.signed_inbox WHERE integration_id=$1 AND (attempts<50 OR reason IN ('evidence_deferred','io_retry'))
      AND ((state='pending' AND available_at<=clock_timestamp()) OR (state='processing' AND lease_until<clock_timestamp()))
      ORDER BY available_at,event_id FOR UPDATE SKIP LOCKED LIMIT batch_size
  ), claimed AS (
    UPDATE piggyvest_primary_card.signed_inbox stored SET state='processing',claim_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',attempts=LEAST(50,attempts+1),updated_at=clock_timestamp()
      FROM due WHERE stored.integration_id=$1 AND stored.event_id=due.event_id
      RETURNING stored.event_id,stored.claim_token,stored.payload,stored.signature,stored.attempts
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('eventId',event_id,'token',claim_token,'rawHex',encode(payload,'hex'),'signature',signature,'attempts',attempts)),'[]'::jsonb) INTO output FROM claimed;
  RETURN output;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.finish_signed_inbox(target_integration uuid, environment text, capability jsonb, signed_event text, token uuid, outcome text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT piggyvest_primary_card.inbox_ready($1,$2,$3) THEN RAISE EXCEPTION 'signed inbox capability unavailable' USING ERRCODE='42501'; END IF;
  IF outcome IS NULL OR outcome NOT IN ('completed','duplicate','deferred','conflict','io_retry') THEN RAISE EXCEPTION 'invalid inbox resolution' USING ERRCODE='22023'; END IF;
  UPDATE piggyvest_primary_card.signed_inbox SET state=CASE WHEN outcome IN ('completed','duplicate') THEN 'processed' WHEN outcome='conflict' OR (attempts=50 AND outcome NOT IN ('deferred','io_retry')) THEN 'blocked' ELSE 'pending' END,
    reason=CASE WHEN outcome IN ('completed','duplicate') THEN NULL WHEN outcome='conflict' THEN 'proof_conflict' WHEN attempts=50 AND outcome NOT IN ('deferred','io_retry') THEN 'attempts_exhausted' WHEN outcome='io_retry' THEN 'io_retry' ELSE 'evidence_deferred' END,
    claim_token=NULL,lease_until=NULL,available_at=clock_timestamp()+make_interval(secs=>LEAST(300,attempts*5)),updated_at=clock_timestamp()
    WHERE integration_id=$1 AND event_id=$4 AND state='processing' AND claim_token=token AND lease_until>clock_timestamp()
      AND (outcome NOT IN ('completed','duplicate') OR EXISTS(
        SELECT 1 FROM piggyvest_primary_card.signed_custody_observations observation
        WHERE observation.integration_id=$1 AND observation.body_digest=signed_inbox.body_digest AND observation.event_id=signed_inbox.event_id
      ));
  RETURN FOUND;
END $$;
COMMIT;
