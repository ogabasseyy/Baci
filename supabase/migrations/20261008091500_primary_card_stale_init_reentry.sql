-- Let status polling re-enter initialization for stale uninitialized claims.
-- A client that receives outcome 'existing' persists the operation ID and
-- polls status forever, but status only verified the provider reference:
-- when the lease holder died before recording, the reference may never
-- have been created (or its session orphaned with the checkout URL lost),
-- so verification can never succeed. Reclaim 'init_unknown' alongside
-- 'initializing' once the five-minute lease expires, resetting the state
-- so the reclaiming holder can record; a live holder still yields
-- 'existing' so concurrent requests share one initialization. Abandonment
-- likewise accepts pre-ready states: a duplicate-reference proof means
-- Paystack holds a session no customer can pay (only 'ready' ever
-- exposes a checkout URL), so the orphaned operation must terminalize —
-- releasing treasury like any abandonment — instead of polling dead.
-- The abandonment keeps 091300's table-presence guards and additionally
-- avoids %ROWTYPE on the reservations table so this migration also
-- applies in chains that predate the treasury tables.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.claim_initialization(scope jsonb, operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation piggyvest_primary_card.operations%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary_card.read_operation(scope,operation_id);
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=operation_id FOR UPDATE;
  IF operation.state IN ('initializing','init_unknown') AND operation.updated_at < clock_timestamp() - interval '5 minutes' THEN
    UPDATE piggyvest_primary_card.operations SET state='initializing',claim_token=gen_random_uuid(),updated_at=clock_timestamp()
      WHERE id=operation_id RETURNING * INTO operation;
    RETURN jsonb_build_object('outcome','claimed','token',operation.claim_token,'intent',piggyvest_primary_card.project(operation));
  END IF;
  IF operation.state <> 'reserved' THEN
    RETURN jsonb_build_object('outcome','existing','intent',piggyvest_primary_card.project(operation));
  END IF;
  UPDATE piggyvest_primary_card.operations SET state='initializing',claim_token=gen_random_uuid(),updated_at=clock_timestamp()
    WHERE id=operation_id RETURNING * INTO operation;
  RETURN jsonb_build_object('outcome','claimed','token',operation.claim_token,'intent',piggyvest_primary_card.project(operation));
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.record_abandonment(scope jsonb, operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  reservation_binding_id uuid;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true);
  SELECT * INTO operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid
    AND state IN ('initializing','init_unknown','ready','abandoned') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF operation.state <> 'abandoned' THEN
    UPDATE piggyvest_primary_card.operations SET state='abandoned',claim_token=NULL,updated_at=clock_timestamp()
      WHERE id=operation_id;
    IF to_regclass('piggyvest_primary_card.reservations') IS NOT NULL THEN
      SELECT reservations.treasury_binding_id INTO reservation_binding_id FROM piggyvest_primary_card.reservations
        WHERE reservations.operation_id=operation.id AND state='reserved' FOR UPDATE;
      IF FOUND THEN
        UPDATE piggyvest_primary_card.reservations SET state='released' WHERE reservations.operation_id=operation.id;
        IF to_regclass('prefunded_card.treasury_bindings') IS NOT NULL THEN
          EXECUTE 'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-$2 WHERE id=$1'
            USING reservation_binding_id,operation.amount_kobo;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN true;
END $$;
COMMIT;
