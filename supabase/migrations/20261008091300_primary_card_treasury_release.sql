-- Release treasury capacity when a checkout terminalizes without custody.
-- record_abandonment freed the customer-facing uniqueness guard but left
-- the operation's reservation row in 'reserved' with its amount still
-- counted in the binding's reserved_kobo (only successful settlement
-- decrements it), so every cancelled checkout permanently consumed
-- treasury capacity until valid funding failed the caps. flag_reconciliation
-- leaks identically: flagged operations can never settle (settlement
-- requires a collection, which flagged states reject), so their
-- reservations are dead weight too. Both functions now atomically mark
-- the reservation 'released' and return its amount to the binding.
-- The release is guarded by table presence: chains that predate the
-- treasury tables (checkout unit chain) skip it, mirroring the codebase's
-- loose-coupling pattern for cross-feature tables. The operations state
-- CHECK is also re-asserted with all eight states: the custody migration
-- re-adds a seven-state CHECK, which would otherwise clobber the
-- 'abandoned' state this migration's function writes.
BEGIN;
ALTER TABLE piggyvest_primary_card.operations DROP CONSTRAINT operations_state_check;
ALTER TABLE piggyvest_primary_card.operations ADD CONSTRAINT operations_state_check CHECK(state IN ('reserved','initializing','init_unknown','ready','custody_pending','reconciliation_required','completed','abandoned'));
ALTER TABLE piggyvest_primary_card.reservations DROP CONSTRAINT reservations_state_check;
ALTER TABLE piggyvest_primary_card.reservations ADD CONSTRAINT reservations_state_check CHECK(state IN ('reserved','consumed','released'));
CREATE OR REPLACE FUNCTION piggyvest_primary_card.record_abandonment(scope jsonb, operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  reservation piggyvest_primary_card.reservations%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true);
  SELECT * INTO operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid
    AND state IN ('ready','abandoned') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF operation.state = 'ready' THEN
    UPDATE piggyvest_primary_card.operations SET state='abandoned',claim_token=NULL,updated_at=clock_timestamp()
      WHERE id=operation_id;
    IF to_regclass('piggyvest_primary_card.reservations') IS NOT NULL THEN
      SELECT * INTO reservation FROM piggyvest_primary_card.reservations
        WHERE reservations.operation_id=operation.id AND state='reserved' FOR UPDATE;
      IF FOUND THEN
        UPDATE piggyvest_primary_card.reservations SET state='released' WHERE reservations.operation_id=operation.id;
        IF to_regclass('prefunded_card.treasury_bindings') IS NOT NULL THEN
          EXECUTE 'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-$2 WHERE id=$1'
            USING reservation.treasury_binding_id,operation.amount_kobo;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.flag_reconciliation(scope jsonb, operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  reservation piggyvest_primary_card.reservations%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true);
  SELECT * INTO operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid
    AND state IN ('reserved','initializing','init_unknown','ready') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE piggyvest_primary_card.operations SET state='reconciliation_required',claim_token=NULL,updated_at=clock_timestamp()
    WHERE id=operation_id;
  IF to_regclass('piggyvest_primary_card.reservations') IS NOT NULL THEN
    SELECT * INTO reservation FROM piggyvest_primary_card.reservations
      WHERE reservations.operation_id=operation.id AND state='reserved' FOR UPDATE;
    IF FOUND THEN
      UPDATE piggyvest_primary_card.reservations SET state='released' WHERE reservations.operation_id=operation.id;
      IF to_regclass('prefunded_card.treasury_bindings') IS NOT NULL THEN
        EXECUTE 'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-$2 WHERE id=$1'
          USING reservation.treasury_binding_id,operation.amount_kobo;
      END IF;
    END IF;
  END IF;
  RETURN true;
END $$;
COMMIT;
