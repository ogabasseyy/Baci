-- Freeze the live offer id and the purchased offer labels (additive).
--
-- The identity guard froze only offer_id_snapshot and offer_line, so a
-- permitted writer could still:
--   1. re-point a live order_items.offer_id from offer A to offer B
--      (including another tenant's publicly discoverable offer id: the
--      FK accepts any valid product_offers row). Cancellation and
--      refund restock route through the live offer_id, so a later
--      cancel would restore B's allocation even though checkout
--      decremented A — corrupting another tenant's inventory.
--   2. rewrite offer_grade / offer_condition_notes after checkout,
--      silently changing the fulfillment labels the admin reader
--      treats as a creation-time snapshot.
-- Reject any UPDATE that changes offer_id to a different non-null
-- value (the FK's delete-to-NULL transition still passes) and any
-- change at all to the two label columns. No migration or app flow
-- writes these columns after insertion — labels are stamped by the
-- order RPCs at creation — so the freeze breaks no legitimate writer;
-- a future sanctioned backfill must relax this trigger explicitly.
-- Reruns converge.
CREATE OR REPLACE FUNCTION private.guard_order_items_offer_id_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Derive, never trust: any caller-supplied snapshot or
    -- discriminator is overwritten from the live offer identity.
    NEW.offer_id_snapshot := NEW.offer_id;
    NEW.offer_line := NEW.offer_id IS NOT NULL;
    RETURN NEW;
  END IF;
  -- UPDATE: the snapshot is immutable once stamped. The only exception
  -- is stamping pre-hardening rows whose snapshot is still NULL — and
  -- even then the value must equal the live FK, never an arbitrary
  -- writer-supplied UUID. (FK ON DELETE SET NULL only nulls offer_id,
  -- leaving both guarded fields untouched, so deletes still pass.)
  IF OLD.offer_id_snapshot IS NULL AND NEW.offer_id_snapshot IS NOT NULL THEN
    IF NEW.offer_id_snapshot IS DISTINCT FROM NEW.offer_id THEN
      RAISE EXCEPTION 'order_items.offer_id_snapshot must match offer_id (order %, item %)',
        NEW.order_id, NEW.id;
    END IF;
  ELSIF OLD.offer_id_snapshot IS NOT NULL
     AND NEW.offer_id_snapshot IS DISTINCT FROM OLD.offer_id_snapshot THEN
    RAISE EXCEPTION 'order_items.offer_id_snapshot is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  IF NEW.offer_line IS DISTINCT FROM OLD.offer_line THEN
    RAISE EXCEPTION 'order_items.offer_line is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  -- The live offer id may only ever transition to NULL (catalog
  -- deletion via the FK). Any reassignment to a different offer —
  -- same tenant or cross-tenant — fails closed, so restock can never
  -- credit an offer checkout never decremented.
  IF NEW.offer_id IS DISTINCT FROM OLD.offer_id
     AND NEW.offer_id IS NOT NULL THEN
    RAISE EXCEPTION 'order_items.offer_id reassignment is forbidden (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  -- Purchased labels are creation-time snapshots: any post-insert
  -- change, including filling a NULL, fails closed.
  IF NEW.offer_grade IS DISTINCT FROM OLD.offer_grade THEN
    RAISE EXCEPTION 'order_items.offer_grade is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  IF NEW.offer_condition_notes IS DISTINCT FROM OLD.offer_condition_notes THEN
    RAISE EXCEPTION 'order_items.offer_condition_notes is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
