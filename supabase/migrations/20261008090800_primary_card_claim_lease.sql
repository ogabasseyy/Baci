-- Supersede unconditional claim reclaim with lease-gated reclaim.
-- Re-issuing a token for every 'initializing' claim breaks overlapping
-- initialize requests: Paystack rejects a repeated transaction reference
-- with a duplicate-reference error, so the reclaiming request records
-- init_unknown while the first request's successful checkout URL is
-- rejected by token fencing. Reclaim only claims older than the lease
-- (five minutes dwarfs the five-second provider timeout, so an
-- unrecorded claim that old implies a dead holder); fresher claims keep
-- outcome 'existing' so concurrent requests share one initialization.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.claim_initialization(scope jsonb, operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation piggyvest_primary_card.operations%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary_card.read_operation(scope,operation_id);
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=operation_id FOR UPDATE;
  IF operation.state = 'initializing' AND operation.updated_at < clock_timestamp() - interval '5 minutes' THEN
    UPDATE piggyvest_primary_card.operations SET claim_token=gen_random_uuid(),updated_at=clock_timestamp()
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
COMMIT;
