-- flag_reconciliation must not release the treasury reservation: every
-- caller flags on AMBIGUITY (provider.verify returns
-- 'reconciliation_required' for evidence mismatches, unexpected statuses,
-- and ANY exception; authoritatively dead checkouts route to 'abandoned'
-- and release via record_abandonment instead). Releasing on flag frees
-- capacity for a customer who may already have been charged, and the
-- reconciliation_required state is absorbing with no automatic path back,
-- so the capacity can never be reclaimed for the pending recovery.
-- The reservation is retained until recovery resolves the operation.
-- The one path that kills recovery is customer deletion: 093300 detaches
-- reconciliation_required operations (SET NULL), after which no
-- scope-bound call can ever touch them again (record_collection matches
-- the operation's customer_id and the customer row is gone), so
-- block_unsettled_customer_deletion now releases their reservations and
-- returns capacity at detach time. The operation row (reference, amount,
-- evidence) is still kept for off-band review/refund.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.flag_reconciliation(scope jsonb, operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true,true);
  SELECT * INTO operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid
    AND state IN ('reserved','initializing','init_unknown','ready') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE piggyvest_primary_card.operations SET state='reconciliation_required',claim_token=NULL,updated_at=clock_timestamp()
    WHERE id=operation_id;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.block_unsettled_customer_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  flagged record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary_card.operations
    WHERE customer_id = OLD.id
      AND state IN ('reserved','initializing','init_unknown','ready','custody_pending')
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unsettled card operations' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('piggyvest_primary_card.reservations') IS NOT NULL THEN
    FOR flagged IN
      SELECT o.id AS operation_id, o.amount_kobo, r.treasury_binding_id
      FROM piggyvest_primary_card.operations o
      JOIN piggyvest_primary_card.reservations r ON r.operation_id = o.id AND r.state = 'reserved'
      WHERE o.customer_id = OLD.id AND o.state = 'reconciliation_required'
      FOR UPDATE OF r
    LOOP
      UPDATE piggyvest_primary_card.reservations SET state='released' WHERE operation_id=flagged.operation_id;
      IF to_regclass('prefunded_card.treasury_bindings') IS NOT NULL THEN
        EXECUTE 'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-$2 WHERE id=$1'
          USING flagged.treasury_binding_id, flagged.amount_kobo;
      END IF;
    END LOOP;
  END IF;
  RETURN OLD;
END $$;
COMMIT;
