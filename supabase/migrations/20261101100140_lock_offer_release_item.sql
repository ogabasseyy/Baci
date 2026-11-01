-- Serialize offer-release snapshot reconciliation with item writers.
CREATE OR REPLACE FUNCTION private.release_stale_offer_line_serialized_units(
  p_merchant_id uuid,
  p_order_id uuid,
  p_item_id uuid,
  p_item_product_id uuid,
  p_event_context jsonb
) RETURNS void LANGUAGE plpgsql AS $release_helper$
DECLARE
  v_release_id uuid;
  v_release_variant_id uuid;
  v_release_product_id uuid;
  v_release_branch_id uuid;
  v_release_from_status text;
  v_released_count integer := 0;
  v_current_fulfillment jsonb;
  v_stripped_fulfillment jsonb;
BEGIN
  -- Lock the item before inventory rows, matching checkout reuse's order.
  -- The confirmation caller does not pre-lock each item. A concurrent
  -- refund or shipment update must commit before we read and rewrite the
  -- fulfillment snapshot, otherwise its fields could be overwritten.
  PERFORM 1 FROM public.order_items WHERE id = p_item_id FOR UPDATE;
  -- Durable holds are status 'reserved' with reservation_expires_at
  -- NULL (no separate status exists), so status = 'reserved' covers
  -- expiring and NULL-expiry holds. Deterministic id order keeps
  -- concurrent releases locking in a common order.
  FOR v_release_id IN
    SELECT vi.id FROM public.variant_inventory vi
    WHERE vi.order_item_id = p_item_id AND vi.status = 'reserved'
      AND vi.merchant_id = p_merchant_id AND vi.order_id = p_order_id
    ORDER BY vi.id
    FOR UPDATE
  LOOP
    -- Attributes are read in a second step because FOR UPDATE cannot
    -- lock the nullable side of the outer join.
    SELECT vi.variant_id, pv.product_id, vi.branch_id, vi.status
    INTO v_release_variant_id, v_release_product_id, v_release_branch_id, v_release_from_status
    FROM public.variant_inventory vi
    LEFT JOIN public.product_variants pv ON pv.id = vi.variant_id
    WHERE vi.id = v_release_id;
    PERFORM private.record_variant_inventory_event(
      v_release_id, p_merchant_id, COALESCE(v_release_product_id, p_item_product_id), v_release_variant_id, 'reservation_released',
      v_release_from_status, 'available', p_order_id, p_item_id, v_release_branch_id, NULL, NULL,
      p_event_context
    );
    -- Lease state is cleared; first_reserved_at is deliberately
    -- preserved: it is backfilled NOT NULL for all historical rows,
    -- reused via COALESCE on re-reservation, and the canonical bulk
    -- releases keep it (provenance, not lease state).
    UPDATE public.variant_inventory
    SET status = 'available',
        order_id = NULL,
        order_item_id = NULL,
        reserved_at = NULL,
        reservation_expires_at = NULL,
        updated_at = now()
    WHERE id = v_release_id;
    v_released_count := v_released_count + 1;
  END LOOP;
  -- Reconcile the line snapshot with actually-attached units. Freed
  -- lines return to the clean offer-line state; a snapshot that still
  -- claims units while the line holds none (detached elsewhere) is
  -- definitionally stale for offer-fulfilled lines. Only unit-derived
  -- keys are stripped so refund/shipment fields survive; a remainder
  -- of nothing (or just the ledger source marker) collapses to NULL
  -- like untouched offer lines.
  SELECT fulfillment_data INTO v_current_fulfillment
  FROM public.order_items WHERE id = p_item_id;
  IF v_current_fulfillment IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.variant_inventory vi
       WHERE vi.order_item_id = p_item_id AND vi.status <> 'available'
     ) AND (
       v_released_count > 0 OR (
         jsonb_typeof(v_current_fulfillment->'inventoryUnits') = 'array'
         AND jsonb_array_length(v_current_fulfillment->'inventoryUnits') > 0
       )
     ) THEN
    v_stripped_fulfillment := v_current_fulfillment
      - ARRAY['inventoryUnits', 'missingUnitCount', 'reservationExpiresAt'];
    IF v_stripped_fulfillment = '{}'::jsonb
       OR v_stripped_fulfillment = '{"source": "merchant_stock"}'::jsonb THEN
      UPDATE public.order_items AS oi
      SET fulfillment_data = NULL
      WHERE oi.id = p_item_id;
    ELSE
      UPDATE public.order_items AS oi
      SET fulfillment_data = v_stripped_fulfillment
      WHERE oi.id = p_item_id;
    END IF;
  END IF;
END $release_helper$;

-- Internal mutation primitive: same privilege profile as the sibling
-- reuse/confirm paths themselves (revoked from all API roles
-- including service_role; reachable only through privileged callers).
REVOKE ALL ON FUNCTION private.release_stale_offer_line_serialized_units(uuid, uuid, uuid, uuid, jsonb)
FROM PUBLIC, anon, authenticated, service_role;
