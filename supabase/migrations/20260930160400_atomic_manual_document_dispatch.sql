-- Atomically validate the rendered snapshot and mark dispatch start for a
-- manual-order document. A check-then-mark in application code leaves a
-- millisecond race between the re-read and the marker; this function holds
-- the order row (FOR SHARE, matching the claim/trigger lock order) while
-- comparing, so a payment, contact correction, or item edit landing
-- mid-dispatch aborts instead of sending a stale document. The worker
-- retries after an abort and converges (fresh send or document_state_changed
-- skip). Safe predeploy: only the new worker calls it.
CREATE OR REPLACE FUNCTION public.mark_manual_document_dispatch_started(
  p_outbox_id uuid,
  p_claim_owner text,
  p_customer_id uuid,
  p_customer_email text,
  p_total numeric,
  p_amount_paid numeric,
  p_payment_status text,
  p_shipping_status text,
  p_item_count integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_notification public.order_notification_outbox%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_item_count bigint;
BEGIN
  -- Lock the order before the outbox (same order as the claim and trigger
  -- paths) and hold it through the comparison and the mark.
  SELECT o.* INTO v_order FROM public.orders AS o
  WHERE o.id = (SELECT n.order_id FROM public.order_notification_outbox AS n WHERE n.id = p_outbox_id)
    AND o.merchant_id = (SELECT n.merchant_id FROM public.order_notification_outbox AS n WHERE n.id = p_outbox_id)
  FOR SHARE;
  SELECT n.* INTO v_notification FROM public.order_notification_outbox AS n
  WHERE n.id = p_outbox_id AND n.status = 'processing'
    AND n.locked_by = p_claim_owner AND n.dispatch_started_at IS NULL
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
  FOR UPDATE;
  IF NOT FOUND OR v_order IS NULL THEN
    RETURN jsonb_build_object('status', 'lease_lost');
  END IF;
  SELECT count(*) INTO v_item_count FROM public.order_items AS oi
  WHERE oi.order_id = v_order.id;
  IF v_order.customer_id IS DISTINCT FROM p_customer_id
    OR lower(trim(both from COALESCE(v_order.customer_email, ''))) IS DISTINCT FROM lower(trim(both from COALESCE(p_customer_email, '')))
    OR v_order.total IS DISTINCT FROM p_total
    OR v_order.amount_paid IS DISTINCT FROM p_amount_paid
    OR v_order.payment_status IS DISTINCT FROM p_payment_status
    OR v_order.shipping_status IS DISTINCT FROM p_shipping_status
    OR v_item_count IS DISTINCT FROM p_item_count::bigint
  THEN
    RETURN jsonb_build_object('status', 'stale');
  END IF;
  UPDATE public.order_notification_outbox AS n
  SET dispatch_started_at = now(), updated_at = now()
  WHERE n.id = p_outbox_id;
  RETURN jsonb_build_object('status', 'marked');
END;
$$;
REVOKE ALL ON FUNCTION public.mark_manual_document_dispatch_started(uuid, text, uuid, text, numeric, numeric, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_manual_document_dispatch_started(uuid, text, uuid, text, numeric, numeric, text, text, integer)
  TO service_role;
