-- Reclaim stale initialization claims instead of stranding the operation.
-- If the process exits after claim_initialization moves an operation to
-- 'initializing' but before record_initialization runs, the claim token is
-- unrecoverable and every retry previously received outcome 'existing' with
-- no session, pinning the customer to an unresolvable operation. Re-issuing
-- a fresh token for 'initializing' is safe: the row lock serializes
-- concurrent claims, the losing token can no longer record, and the
-- deterministic reference makes provider re-initialization idempotent
-- (Paystack returns the existing session for a repeated reference).
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.claim_initialization(scope jsonb, operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation piggyvest_primary_card.operations%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary_card.read_operation(scope,operation_id);
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=operation_id FOR UPDATE;
  IF operation.state = 'initializing' THEN
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
