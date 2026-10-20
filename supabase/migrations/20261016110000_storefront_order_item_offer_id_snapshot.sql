-- Preserve the exact purchased offer identity after catalog deletion.
-- Migration 20261008320000 made order_items.offer_id ON DELETE SET NULL so
-- deleting a product (which cascades to its offers) no longer fails order
-- history — but condition/grade/notes alone cannot identify WHICH of two
-- same-condition offers was purchased, and the admin copy-ref goes blank
-- once the FK nulls. Stamp an immutable snapshot of the id at insert and
-- forbid later changes; ON DELETE SET NULL still clears only the live FK.
-- Reruns converge.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS offer_id_snapshot uuid;

COMMENT ON COLUMN public.order_items.offer_id_snapshot IS
  'Immutable creation-time copy of offer_id; survives ON DELETE SET NULL so staff keep the exact purchased offer identity after catalog deletion.';

-- Backfill rows written before this migration. Rows whose offer row was
-- already deleted keep NULL: nothing recoverable to stamp.
UPDATE public.order_items
SET offer_id_snapshot = offer_id
WHERE offer_id_snapshot IS NULL AND offer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.guard_order_items_offer_id_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.offer_id_snapshot IS NULL THEN
      NEW.offer_id_snapshot := NEW.offer_id;
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: the snapshot is immutable once stamped. Only the first
  -- stamping (NULL -> value) is allowed, so pre-migration rows with a
  -- live FK can still be stamped by a later write; any change to a
  -- stamped value — including clearing it — fails closed. FK
  -- ON DELETE SET NULL fires this trigger too, but it only nulls
  -- offer_id, leaving the snapshot untouched, so deletes still pass.
  IF OLD.offer_id_snapshot IS NOT NULL
     AND NEW.offer_id_snapshot IS DISTINCT FROM OLD.offer_id_snapshot THEN
    RAISE EXCEPTION 'order_items.offer_id_snapshot is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_offer_id_snapshot_guard
  ON public.order_items;
CREATE TRIGGER order_items_offer_id_snapshot_guard
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_order_items_offer_id_snapshot();
