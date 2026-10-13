BEGIN;
-- Let reconciliation_required card operations detach on customer
-- deletion instead of blocking it. The operation holds no live
-- money-movement state: flag_reconciliation releases the treasury
-- reservation, record_collection rejects the state (so no collection
-- row can exist or ever be created), and transfer_outbox rows are only
-- enqueued AFTER INSERT ON collections (07200300) — so no outbox row
-- can exist either. settle_custody raises 'uncollected custody'
-- without a collection, and status polling returns the state without
-- re-verifying: deletion cannot strand a dispatch that is already
-- impossible. The state is absorbing — abandonment accepts only
-- initializing/init_unknown/ready — so blocking deletion on it would
-- lock the account permanently with no terminal transition. The 092700
-- SET NULL keeps the operation row (reference, amount, evidence) for
-- off-band review/refund while the customer row deletes normally.
CREATE OR REPLACE FUNCTION piggyvest_primary_card.block_unsettled_customer_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary_card.operations
    WHERE customer_id = OLD.id
      AND state IN ('reserved','initializing','init_unknown','ready','custody_pending')
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unsettled card operations' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;
COMMIT;
