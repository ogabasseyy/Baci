-- Keep catalog-off transaction cost/supplier edits working for authenticated
-- merchants without granting access to the private amendment permit table.
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
    -- Either identity marks an offer line: condition-only lines have
    -- no exact id but still decremented the resolved offer's
    -- allocation at creation.
    NEW.offer_id_snapshot := NEW.offer_id;
    NEW.offer_line := NEW.offer_id IS NOT NULL OR NEW.product_offer_id IS NOT NULL;
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
  -- A trusted amendment supplies an exact one-use authorization after moving
  -- offer inventory. An ordinary writer cannot create or consume a permit.
  IF OLD.id = NEW.id AND OLD.order_id = NEW.order_id
     AND OLD.product_offer_id IS DISTINCT FROM NEW.product_offer_id THEN
    -- An invoker can fire this trigger without USAGE on private. A regclass
    -- literal is resolved when the expression is planned, even when the
    -- preceding predicates are false. Look up the owner via system catalogs
    -- and only resolve the private DELETE for the owner.
    IF current_user = (
      SELECT pg_catalog.pg_get_userbyid(c.relowner)
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private'
        AND c.relname = 'paid_order_offer_amendment_writes'
    ) THEN
      DELETE FROM private.paid_order_offer_amendment_writes
      WHERE item_id = OLD.id AND order_id = OLD.order_id
        AND target = jsonb_build_array(NEW.product_id, NEW.product_offer_id,
          NEW.offer_id, NEW.offer_id_snapshot, NEW.offer_line, NEW.offer_grade,
          NEW.offer_condition_notes, NEW.offer_labels_snapshotted);
      IF FOUND THEN RETURN NEW; END IF;
    END IF;
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
