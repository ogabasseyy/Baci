BEGIN;
CREATE TABLE prefunded_card.dispatch_queue (
  operation_id uuid PRIMARY KEY REFERENCES prefunded_card.operations(id),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claim_token uuid,
  lease_expires_at timestamptz,
  finished_at timestamptz,
  attempts bigint NOT NULL DEFAULT 0 CHECK(attempts>=0)
);
ALTER TABLE prefunded_card.dispatch_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prefunded_card.dispatch_queue FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX prefunded_card_dispatch_due ON prefunded_card.dispatch_queue(available_at) WHERE finished_at IS NULL;
CREATE FUNCTION prefunded_card.enqueue_dispatch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO prefunded_card.dispatch_queue(operation_id) VALUES(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER prefunded_card_enqueue AFTER INSERT ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.enqueue_dispatch();
INSERT INTO prefunded_card.dispatch_queue(operation_id)
  SELECT id FROM prefunded_card.operations WHERE transfer_status IN ('dispatching','pending','unknown')
    OR (projection_status='unapplied'
      AND collection_status NOT IN ('verified_failed','reversed','action_required'));

CREATE FUNCTION prefunded_card.claim_due(p_integration uuid,p_business text,p_system text,p_limit integer,p_merchant uuid,p_treasury uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE; candidate record; token uuid; result jsonb:='[]';
BEGIN
  IF p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20
    OR current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'prefunded dispatch identity refused' USING ERRCODE='42501';
  END IF;
  FOR binding IN SELECT * FROM prefunded_card.treasury_bindings WHERE integration_id=p_integration
    AND expected_business_id=p_business AND authorized_login=session_user
    AND merchant_id=p_merchant AND id=p_treasury ORDER BY id FOR UPDATE SKIP LOCKED LOOP
    FOR candidate IN SELECT queue.operation_id FROM prefunded_card.dispatch_queue queue
      JOIN prefunded_card.operations operation ON operation.id=queue.operation_id
      WHERE operation.treasury_binding_id=binding.id AND operation.integration_id=p_integration
        AND queue.finished_at IS NULL AND queue.available_at<=clock_timestamp()
        AND (queue.lease_expires_at IS NULL OR queue.lease_expires_at<=clock_timestamp())
      ORDER BY queue.available_at,queue.operation_id LIMIT (p_limit-jsonb_array_length(result))
      FOR UPDATE OF queue SKIP LOCKED LOOP
      token:=gen_random_uuid();
      UPDATE prefunded_card.dispatch_queue SET claim_token=token,lease_expires_at=clock_timestamp()+interval '120 seconds',
        attempts=attempts+1 WHERE operation_id=candidate.operation_id;
      result:=result||jsonb_build_array(jsonb_build_object('operationId',candidate.operation_id,'token',token));
    END LOOP;
    EXIT WHEN jsonb_array_length(result)>=p_limit;
  END LOOP;
  RETURN result;
END $$;
CREATE FUNCTION prefunded_card.finish_dispatch(p_operation uuid,p_token uuid,p_system text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  UPDATE prefunded_card.dispatch_queue SET claim_token=NULL,lease_expires_at=NULL,
    available_at=clock_timestamp()+interval '30 seconds',
    finished_at=CASE WHEN operation.transfer_status IN ('dispatching','pending','unknown') THEN NULL
      WHEN operation.projection_status IN ('applied','reconciliation_required')
      OR operation.collection_status IN ('verified_failed','reversed','action_required')
      OR operation.transfer_status='verified_failed' THEN clock_timestamp() ELSE NULL END
    WHERE operation_id=p_operation AND claim_token=p_token AND lease_expires_at>clock_timestamp();
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION prefunded_card.enqueue_dispatch(),prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid),
  prefunded_card.finish_dispatch(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
