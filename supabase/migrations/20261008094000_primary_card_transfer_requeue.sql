-- Requeue transfer-dispatch claims whose provider submission provably
-- never happened. A submitTransport throw (DNS, timeout, 5xx before
-- commit) recorded the outbox row as 'unknown', but no reconciler ever
-- revisits 'unknown' rows and no custody webhook can arrive for a
-- transfer that was never created, so the charged checkout stayed
-- 'custody_pending' indefinitely. The worker now reconciles the
-- deterministic provider reference after a submit failure; only a
-- proven-absent reference may call this function, which returns the
-- dispatching row to 'ready' under the same claim token so the next
-- worker pass resubmits with the identical reference. Uncertain or
-- submitted lookups keep the existing record_transfer path.
BEGIN;
CREATE FUNCTION piggyvest_primary_card.requeue_transfer(integration_id uuid, environment text, operation_id uuid, token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary_card.assert_worker($1,$2,false);
  PERFORM id FROM piggyvest_primary_card.operations WHERE id=$3 AND operations.integration_id=$1 AND operations.environment=$2;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer ownership unavailable' USING ERRCODE='42501'; END IF;
  UPDATE piggyvest_primary_card.transfer_outbox SET state='ready',claim_token=NULL,updated_at=clock_timestamp()
    WHERE transfer_outbox.operation_id=$3 AND state='dispatching' AND claim_token=token;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.requeue_transfer(uuid,text,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_evidence,primary_card_transfer_worker,primary_card_custody_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.requeue_transfer(uuid,text,uuid,uuid) TO primary_card_transfer_worker;
COMMIT;
