-- Bind inserted offer ids to the order tenant and freeze the label marker.
--
-- Follow-up to 20261016140000 (append-only: that file is untouched; this
-- migration replaces the guard function body with a strict superset):
--   1. INSERT copied any valid offer_id without checking that the offer
--      belongs to the line's product or the order's merchant. The FK
--      only proves the offer exists and the insert RLS policy only
--      scopes order_id, so an authenticated merchant could add a line
--      to its own order referencing another tenant's offer; cancelling
--      that order later would make the offer-restock branch increment
--      the victim offer's allocation. Reject cross-product and
--      cross-merchant offer ids at insert.
--   2. UPDATE froze the two label values but left
--      offer_labels_snapshotted mutable. Flipping the marker true->false
--      on an intentionally-empty snapshot makes the admin reader treat
--      the row as legacy and display mutable live labels, silently
--      rewriting fulfillment history. The marker is stamped at INSERT
--      by the order RPCs and no flow updates it after insertion, so
--      freeze it unconditionally.
-- RLS posture: the trigger runs with the inserter's privileges. A
-- direct-insert caller whose RLS view hides the victim offer (or the
-- order) reads NOT FOUND and fails closed below. The order RPCs run
-- SECURITY DEFINER, so legitimate checkout inserts see every row they
-- need and pass. Reruns converge (pure CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION private.guard_order_items_offer_id_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_offer_product_id uuid;
  v_offer_merchant_id uuid;
  v_order_merchant_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Derive, never trust: any caller-supplied snapshot or
    -- discriminator is overwritten from the live offer identity.
    NEW.offer_id_snapshot := NEW.offer_id;
    NEW.offer_line := NEW.offer_id IS NOT NULL;
    IF NEW.offer_id IS NOT NULL THEN
      -- The FK proves the offer exists but says nothing about whose
      -- it is: bind it to this line's product and this order's
      -- merchant before the row can reference a foreign offer.
      SELECT po.product_id, po.merchant_id
        INTO v_offer_product_id, v_offer_merchant_id
        FROM public.product_offers AS po
       WHERE po.id = NEW.offer_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'order_items.offer_id does not exist (order %, item %)',
          NEW.order_id, NEW.id;
      END IF;
      IF v_offer_product_id IS DISTINCT FROM NEW.product_id THEN
        RAISE EXCEPTION 'order_items.offer_id does not belong to the line product (order %, item %)',
          NEW.order_id, NEW.id;
      END IF;
      SELECT o.merchant_id
        INTO v_order_merchant_id
        FROM public.orders AS o
       WHERE o.id = NEW.order_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'order_items.order_id does not exist (order %, item %)',
          NEW.order_id, NEW.id;
      END IF;
      IF v_offer_merchant_id IS DISTINCT FROM v_order_merchant_id THEN
        RAISE EXCEPTION 'order_items.offer_id belongs to another merchant (order %, item %)',
          NEW.order_id, NEW.id;
      END IF;
    END IF;
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
  -- The snapshot marker is part of the frozen creation-time truth:
  -- flipping it would re-expose mutable live labels on a snapshotted
  -- line. Stamped at INSERT by the order RPCs; no legitimate UPDATE
  -- flow touches it.
  IF NEW.offer_labels_snapshotted IS DISTINCT FROM OLD.offer_labels_snapshotted THEN
    RAISE EXCEPTION 'order_items.offer_labels_snapshotted is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
