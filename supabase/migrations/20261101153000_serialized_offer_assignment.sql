-- Unit-to-offer assignment is additive. Checkout remains gated until the
-- availability and reservation authorities are made condition-aware.
ALTER TABLE public.variant_inventory
  ADD COLUMN IF NOT EXISTS condition_offer_id uuid;

CREATE INDEX IF NOT EXISTS variant_inventory_condition_offer_available_idx
  ON public.variant_inventory (merchant_id, condition_offer_id, variant_id, created_at, id)
  WHERE condition_offer_id IS NOT NULL AND status = 'available'
    AND order_id IS NULL AND order_item_id IS NULL AND sold_at IS NULL;

-- Guard and deletion lookups span available, reserved and sold units.
CREATE INDEX IF NOT EXISTS variant_inventory_condition_offer_id_idx
  ON public.variant_inventory (condition_offer_id)
  WHERE condition_offer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.guard_serialized_offer_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_product_id uuid;
BEGIN
  IF NEW.condition_offer_id IS NOT NULL THEN
    SELECT v.product_id INTO v_product_id FROM public.product_variants AS v
      WHERE v.id = NEW.variant_id AND v.merchant_id = NEW.merchant_id;
    IF v_product_id IS NOT NULL THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('serialized-offer:' || v_product_id::text, 0));
    END IF;
  END IF;
  IF NEW.condition_offer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_offers AS o
    JOIN public.product_variants AS v ON v.product_id = o.product_id
      AND v.merchant_id = o.merchant_id
    JOIN public.products AS p ON p.id = v.product_id AND p.merchant_id = v.merchant_id
    WHERE o.id = NEW.condition_offer_id AND o.merchant_id = NEW.merchant_id
      AND v.id = NEW.variant_id AND v.is_inventory_anchor IS TRUE
      AND p.inventory_anchor_variant_id = v.id
      AND p.has_variants IS DISTINCT FROM TRUE
      AND coalesce(p.variant_model, 'legacy') <> 'sku_matrix'
  ) THEN
    RAISE EXCEPTION 'invalid_serialized_offer_assignment' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_serialized_offer_identity ON public.variant_inventory;
CREATE TRIGGER guard_serialized_offer_identity
  BEFORE INSERT OR UPDATE OF condition_offer_id, merchant_id, variant_id
  ON public.variant_inventory FOR EACH ROW
  EXECUTE FUNCTION private.guard_serialized_offer_identity();

-- Keep a reserved unit's immutable offer identity if its offer is deleted so
-- an existing order can be replayed. Available units are safely unassigned.
CREATE OR REPLACE FUNCTION private.unassign_available_units_on_offer_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.variant_inventory SET condition_offer_id = NULL, updated_at = now()
  WHERE condition_offer_id = OLD.id AND status = 'available'
    AND order_id IS NULL AND order_item_id IS NULL AND sold_at IS NULL;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS unassign_available_units_on_offer_delete ON public.product_offers;
CREATE TRIGGER unassign_available_units_on_offer_delete
  BEFORE DELETE ON public.product_offers FOR EACH ROW
  EXECUTE FUNCTION private.unassign_available_units_on_offer_delete();

-- A unit returning to available after its offer was deleted is no longer
-- tied to a purchasable offer and rejoins the ordinary inventory pool.
CREATE OR REPLACE FUNCTION private.clear_deleted_offer_on_unit_release()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'available' AND NEW.status = 'available'
    AND NEW.order_id IS NULL AND NEW.order_item_id IS NULL
    AND NEW.condition_offer_id IS NOT NULL THEN
    -- Serialize against offer deletion before deciding whether to clear the
    -- tombstone. KEY SHARE is compatible with the assignment's SHARE lock.
    PERFORM 1 FROM public.product_offers AS o
      WHERE o.id = NEW.condition_offer_id FOR KEY SHARE;
    IF NOT FOUND THEN
      NEW.condition_offer_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS clear_deleted_offer_on_unit_release ON public.variant_inventory;
CREATE TRIGGER clear_deleted_offer_on_unit_release
  BEFORE UPDATE OF status, order_id, order_item_id ON public.variant_inventory
  FOR EACH ROW EXECUTE FUNCTION private.clear_deleted_offer_on_unit_release();

CREATE OR REPLACE FUNCTION private.guard_assigned_offer_move()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.product_id, NEW.merchant_id, NEW.condition) IS DISTINCT FROM (OLD.product_id, OLD.merchant_id, OLD.condition)
    AND EXISTS (SELECT 1 FROM public.variant_inventory AS vi WHERE vi.condition_offer_id = OLD.id) THEN
    RAISE EXCEPTION 'assigned_offer_cannot_move' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_assigned_offer_move ON public.product_offers;
CREATE TRIGGER guard_assigned_offer_move
  BEFORE UPDATE OF product_id, merchant_id, condition ON public.product_offers
  FOR EACH ROW EXECUTE FUNCTION private.guard_assigned_offer_move();

CREATE OR REPLACE FUNCTION private.guard_assigned_inventory_anchor_move()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.id, NEW.product_id, NEW.merchant_id, NEW.is_inventory_anchor)
      IS DISTINCT FROM (OLD.id, OLD.product_id, OLD.merchant_id, OLD.is_inventory_anchor) THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('serialized-offer:' || OLD.product_id::text, 0));
    IF EXISTS (SELECT 1 FROM public.variant_inventory AS vi
      WHERE vi.variant_id = OLD.id AND vi.condition_offer_id IS NOT NULL) THEN
      RAISE EXCEPTION 'assigned_inventory_anchor_cannot_move' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_assigned_inventory_anchor_move ON public.product_variants;
CREATE TRIGGER guard_assigned_inventory_anchor_move
  BEFORE UPDATE OF id, product_id, merchant_id, is_inventory_anchor ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION private.guard_assigned_inventory_anchor_move();

CREATE OR REPLACE FUNCTION private.guard_assigned_product_inventory_shape()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.id, NEW.merchant_id, NEW.inventory_anchor_variant_id, NEW.has_variants, NEW.variant_model)
      IS DISTINCT FROM (OLD.id, OLD.merchant_id, OLD.inventory_anchor_variant_id, OLD.has_variants, OLD.variant_model) THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('serialized-offer:' || OLD.id::text, 0));
    IF EXISTS (SELECT 1 FROM public.variant_inventory AS vi
      JOIN public.product_variants AS v ON v.id = vi.variant_id
      WHERE v.product_id = OLD.id AND vi.condition_offer_id IS NOT NULL) THEN
      RAISE EXCEPTION 'assigned_product_inventory_shape_cannot_change' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_assigned_product_inventory_shape ON public.products;
CREATE TRIGGER guard_assigned_product_inventory_shape
  BEFORE UPDATE OF id, merchant_id, inventory_anchor_variant_id, has_variants, variant_model ON public.products
  FOR EACH ROW EXECUTE FUNCTION private.guard_assigned_product_inventory_shape();

CREATE OR REPLACE FUNCTION private.assign_variant_inventory_unit_offer(
  p_merchant_id uuid, p_unit_id uuid, p_offer_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_product_id uuid;
  v_variant_id uuid;
  v_unit public.variant_inventory%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND public.has_merchant_access(p_merchant_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT v.product_id, vi.variant_id INTO v_product_id, v_variant_id
  FROM public.variant_inventory AS vi
  JOIN public.product_variants AS v ON v.id = vi.variant_id AND v.merchant_id = vi.merchant_id
  WHERE vi.id = p_unit_id AND vi.merchant_id = p_merchant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'P0002'; END IF;

  -- Key-share protects deletion/key changes without blocking stock-sync's
  -- ordinary updates while we wait for the inventory unit.
  PERFORM 1 FROM public.products AS p WHERE p.id = v_product_id AND p.merchant_id = p_merchant_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.product_variants AS v WHERE v.id = v_variant_id
    AND v.product_id = v_product_id AND v.merchant_id = p_merchant_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_offer_id IS NOT NULL THEN
    PERFORM 1 FROM public.product_offers AS o WHERE o.id = p_offer_id
      AND o.product_id = v_product_id AND o.merchant_id = p_merchant_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_serialized_offer_assignment' USING ERRCODE = '22023'; END IF;
  END IF;
  SELECT vi.* INTO v_unit FROM public.variant_inventory AS vi
  WHERE vi.id = p_unit_id AND vi.merchant_id = p_merchant_id AND vi.variant_id = v_variant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_unit.status IS DISTINCT FROM 'available' OR v_unit.order_id IS NOT NULL
    OR v_unit.order_item_id IS NOT NULL OR v_unit.sold_at IS NOT NULL THEN
    RAISE EXCEPTION 'unit_not_assignable' USING ERRCODE = '22023';
  END IF;
  UPDATE public.variant_inventory SET condition_offer_id = p_offer_id, updated_at = now()
  WHERE id = p_unit_id;
  RETURN jsonb_build_object('unitId', p_unit_id, 'offerId', p_offer_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_variant_inventory_unit_offer(
  p_merchant_id uuid, p_unit_id uuid, p_offer_id uuid
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.assign_variant_inventory_unit_offer(p_merchant_id, p_unit_id, p_offer_id);
$$;
REVOKE ALL ON FUNCTION private.guard_serialized_offer_identity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.unassign_available_units_on_offer_delete() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.clear_deleted_offer_on_unit_release() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_assigned_offer_move() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_assigned_inventory_anchor_move() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_assigned_product_inventory_shape() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assign_variant_inventory_unit_offer(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_variant_inventory_unit_offer(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.assign_variant_inventory_unit_offer(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_variant_inventory_unit_offer(uuid, uuid, uuid) TO authenticated, service_role;

-- The merchant-only listing exposes the assignment, never through the
-- public catalog projection. Fail closed if its source changes upstream.
DO $$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'private.list_variant_inventory_units(uuid,uuid,uuid,text,text,uuid,integer,timestamptz,uuid)'::regprocedure
  );
  old_selection text := $old$      vi.id,
      pv.product_id,$old$;
  new_selection text := $new$      vi.id,
      vi.condition_offer_id,
      pv.is_inventory_anchor,
      pv.product_id,$new$;
  old_json text := $old$        'id', v_row.id,
        'product_id', v_row.product_id,$old$;
  new_json text := $new$        'id', v_row.id,
        'condition_offer_id', v_row.condition_offer_id,
        'is_inventory_anchor', v_row.is_inventory_anchor,
        'product_id', v_row.product_id,$new$;
BEGIN
  IF (length(definition) - length(replace(definition, old_selection, ''))) / length(old_selection) <> 1
    OR (length(definition) - length(replace(definition, old_json, ''))) / length(old_json) <> 1 THEN
    RAISE EXCEPTION 'serialized inventory listing source mismatch';
  END IF;
  EXECUTE replace(replace(definition, old_selection, new_selection), old_json, new_json);
END;
$$;
