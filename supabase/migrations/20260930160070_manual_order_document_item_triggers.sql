-- Item statement triggers for manual-order documents, split out of
-- 20260930160000 (300-line rule). INSERT/UPDATE/DELETE on order_items
-- re-evaluate the affected orders through
-- private.enqueue_manual_order_document (runtime-resolved, so definition
-- order between the two files is irrelevant). Triggers ship DISABLED;
-- 20260930160300 enables them post-deploy.

-- AFTER UPDATE keeps item corrections symmetric with order corrections: a
-- stale/failed dispatch unblocked by an item edit re-arms the same way an
-- order-field correction does. AFTER DELETE covers the partial correction:
-- removing one invalid line from a multi-item order leaves a valid nonempty
-- order that must re-evaluate too, not just the wipe-and-reinsert cycle.
-- Postgres forbids OLD TABLE on INSERT triggers (and NEW TABLE on DELETE
-- triggers), and a function referencing an unbound transition table errors
-- at runtime, so each event gets its own trigger binding only its legal
-- table(s) over its own function. UPDATE binds both so an item moved
-- across orders re-evaluates the old order as well as the new one.
CREATE OR REPLACE FUNCTION private.enqueue_manual_documents_after_item_inserts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order_id uuid;
BEGIN
  -- The statement-level trigger observes the whole item batch, not its
  -- first row; DISTINCT keeps one enqueue per order per batch.
  FOR v_order_id IN (
    SELECT DISTINCT order_id FROM inserted_items ORDER BY order_id
  ) LOOP
    PERFORM private.enqueue_manual_order_document(v_order_id);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_manual_documents_after_item_inserts()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enqueue_manual_documents_after_items
  AFTER INSERT ON public.order_items REFERENCING NEW TABLE AS inserted_items
  FOR EACH STATEMENT EXECUTE FUNCTION private.enqueue_manual_documents_after_item_inserts();
CREATE OR REPLACE FUNCTION private.enqueue_manual_documents_after_item_updates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order_id uuid;
BEGIN
  -- Rendered-column gate (function-level: transition tables cannot combine
  -- with an UPDATE OF column list). Fulfillment-only writes such as
  -- fulfillment_data assignment must not re-enqueue: one landing after
  -- provider dispatch resets the marker and pushes the accepted,
  -- still-current attachment into a corrective retry that can send a
  -- duplicate with a rotated link. order_id stays compared so lines moving
  -- between orders re-enqueue both sides.
  FOR v_order_id IN (
    SELECT DISTINCT ids.order_id AS order_id
    FROM inserted_items AS n
    FULL JOIN removed_items AS o ON o.id = n.id
    -- A line moving between orders emits BOTH sides: the source loses a
    -- rendered line and the destination gains one, so each order's
    -- dispatch must be re-evaluated. Same-order edits dedup to one id.
    CROSS JOIN LATERAL (
      VALUES (n.order_id), (o.order_id)
    ) AS ids(order_id)
    WHERE ids.order_id IS NOT NULL
      AND (n.order_id IS DISTINCT FROM o.order_id
      OR n.name IS DISTINCT FROM o.name
      OR n.quantity IS DISTINCT FROM o.quantity
      OR n.price IS DISTINCT FROM o.price
      OR n.variant_name IS DISTINCT FROM o.variant_name
      OR n.condition IS DISTINCT FROM o.condition
      OR n.item_description IS DISTINCT FROM o.item_description
      OR n.assurance_fee IS DISTINCT FROM o.assurance_fee
      OR n.line_id IS DISTINCT FROM o.line_id
      OR n.unit_code IS DISTINCT FROM o.unit_code
      OR n.line_extension_amount IS DISTINCT FROM o.line_extension_amount
      OR n.vat_category_code IS DISTINCT FROM o.vat_category_code
      OR n.vat_rate IS DISTINCT FROM o.vat_rate
      OR n.vat_amount IS DISTINCT FROM o.vat_amount
      OR n.sellers_item_id IS DISTINCT FROM o.sellers_item_id
      )
    ORDER BY order_id
  ) LOOP
    PERFORM private.enqueue_manual_order_document(v_order_id);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_manual_documents_after_item_updates()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enqueue_manual_documents_after_item_updates
  AFTER UPDATE ON public.order_items REFERENCING NEW TABLE AS inserted_items OLD TABLE AS removed_items
  FOR EACH STATEMENT EXECUTE FUNCTION private.enqueue_manual_documents_after_item_updates();
CREATE OR REPLACE FUNCTION private.enqueue_manual_documents_after_item_deletes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order_id uuid;
BEGIN
  FOR v_order_id IN (
    SELECT DISTINCT order_id FROM removed_items ORDER BY order_id
  ) LOOP
    PERFORM private.enqueue_manual_order_document(v_order_id);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_manual_documents_after_item_deletes()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enqueue_manual_documents_after_item_deletes
  AFTER DELETE ON public.order_items REFERENCING OLD TABLE AS removed_items
  FOR EACH STATEMENT EXECUTE FUNCTION private.enqueue_manual_documents_after_item_deletes();

-- Ship disabled with the rest of the manual-document triggers; the
-- postdeploy enable step activates them together.
ALTER TABLE public.order_items DISABLE TRIGGER enqueue_manual_documents_after_items;
ALTER TABLE public.order_items DISABLE TRIGGER enqueue_manual_documents_after_item_updates;
ALTER TABLE public.order_items DISABLE TRIGGER enqueue_manual_documents_after_item_deletes;
