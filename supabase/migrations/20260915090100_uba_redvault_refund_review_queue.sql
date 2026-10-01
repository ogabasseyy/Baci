CREATE OR REPLACE FUNCTION private.enqueue_redvault_refund_inventory_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.inventory_state = 'review_required' THEN
    -- One unresolved row per (issue_type, order_id): fold additional refunds
    -- into the open order review instead of violating
    -- reconciliation_review_open_by_order_idx and aborting finalization.
    UPDATE public.reconciliation_review AS review
    SET reason = COALESCE(NEW.review_reason, review.reason),
        metadata = review.metadata || jsonb_build_object(
          'refundId', NEW.refund_id,
          'inventoryReceipt', NEW.inventory_receipt,
          'refundIds', COALESCE(review.metadata->'refundIds', '[]'::jsonb)
            || jsonb_build_array(NEW.refund_id))
    WHERE review.issue_type = 'serialized_inventory_confirmation_failed'
      AND review.order_id = NEW.order_id
      AND review.resolved_at IS NULL
      AND NOT (COALESCE(review.metadata->'refundIds', '[]'::jsonb) ? NEW.refund_id::text)
      AND review.metadata->>'refundId' IS DISTINCT FROM NEW.refund_id::text;
    IF NOT FOUND THEN
      INSERT INTO public.reconciliation_review (
        issue_type, order_id, reason, metadata
      )
      SELECT
        'serialized_inventory_confirmation_failed', NEW.order_id,
        COALESCE(NEW.review_reason, 'REDVAULT refund inventory requires review'),
        jsonb_build_object('refundId', NEW.refund_id, 'inventoryReceipt', NEW.inventory_receipt,
          'refundIds', jsonb_build_array(NEW.refund_id))
      WHERE NOT EXISTS (
        SELECT 1 FROM public.reconciliation_review AS review
        WHERE review.issue_type = 'serialized_inventory_confirmation_failed'
          AND review.order_id = NEW.order_id
          AND review.resolved_at IS NULL
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enqueue_redvault_refund_inventory_review() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enqueue_redvault_refund_inventory_review()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enqueue_redvault_refund_inventory_review
  ON private.uba_redvault_refund_lifecycle;
CREATE TRIGGER enqueue_redvault_refund_inventory_review
  AFTER INSERT OR UPDATE OF inventory_state ON private.uba_redvault_refund_lifecycle
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_redvault_refund_inventory_review();

CREATE OR REPLACE FUNCTION public.resolve_uba_redvault_refund_inventory_review(
  p_refund_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_refund private.uba_redvault_refunds%ROWTYPE;
  v_lifecycle private.uba_redvault_refund_lifecycle%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: REDVAULT refund review resolution requires service_role';
  END IF;

  SELECT * INTO STRICT v_refund
  FROM private.uba_redvault_refunds
  WHERE id = p_refund_id;
  SELECT * INTO STRICT v_lifecycle
  FROM private.uba_redvault_refund_lifecycle
  WHERE refund_id = p_refund_id
  FOR UPDATE;

  IF v_lifecycle.inventory_state <> 'review_required' THEN
    RETURN jsonb_build_object('success', true, 'refundId', p_refund_id,
      'inventoryState', v_lifecycle.inventory_state);
  END IF;

  v_result := private.release_redvault_refund_inventory_units(p_refund_id);
  UPDATE private.uba_redvault_refund_lifecycle
  SET inventory_state = 'released', review_reason = NULL, inventory_receipt = v_result
  WHERE refund_id = p_refund_id AND inventory_state = 'review_required';
  UPDATE public.reconciliation_review
  SET resolved_at = pg_catalog.clock_timestamp(),
      resolution_notes = 'REDVAULT refund inventory safely released by protected resolver.'
  WHERE issue_type = 'serialized_inventory_confirmation_failed'
    AND order_id = v_lifecycle.order_id
    AND (metadata->>'refundId' = p_refund_id::text
      OR metadata->'refundIds' ? p_refund_id::text)
    AND resolved_at IS NULL;
  RETURN v_result || jsonb_build_object('inventoryState', 'released');
END;
$$;
ALTER FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid)
  TO service_role;
