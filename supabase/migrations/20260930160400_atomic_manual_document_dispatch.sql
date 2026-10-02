-- Atomically validate the rendered snapshot and mark dispatch start for a
-- manual-order document. A check-then-mark in application code leaves a
-- millisecond race between the re-read and the marker; this function holds
-- the order row (FOR SHARE, matching the claim/trigger lock order) while
-- comparing, so a payment, contact correction, or item edit landing
-- mid-dispatch aborts instead of sending a stale document. The snapshot
-- covers every order-row input the renderer reads (identity, money
-- breakdown, notes, address, dates, and item contents): a same-total money
-- redistribution or address correction aborts too. Merchant-profile and
-- ledger rows are outside the snapshot; ledger rows derive from the covered
-- payment state, and a merchant edit landing in the dispatch window is
-- accepted as negligible. The worker retries after an abort and converges
-- (fresh send or document_state_changed skip). Safe predeploy: only the new
-- worker calls it.
CREATE OR REPLACE FUNCTION public.mark_manual_document_dispatch_started(
  p_outbox_id uuid,
  p_claim_owner text,
  p_customer_id uuid,
  p_customer_email text,
  p_customer_name text,
  p_customer_phone text,
  p_total numeric,
  p_subtotal numeric,
  p_shipping_fee numeric,
  p_tax_amount numeric,
  p_discount_amount numeric,
  p_amount_paid numeric,
  p_currency text,
  p_order_number text,
  p_payment_status text,
  p_payment_method text,
  p_shipping_status text,
  p_invoice_type_code text,
  p_invoice_note text,
  p_notes text,
  p_transaction_date timestamptz,
  p_invoice_issue_date date,
  p_shipping_address jsonb,
  p_item_count integer,
  p_items jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_notification public.order_notification_outbox%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_item_count bigint;
  v_items jsonb;
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', oi.id, 'name', oi.name, 'quantity', oi.quantity, 'price', oi.price,
    'variant_name', oi.variant_name, 'condition', oi.condition
  ) ORDER BY oi.id), '[]'::jsonb) INTO v_items
  FROM public.order_items AS oi
  WHERE oi.order_id = v_order.id;
  IF v_order.customer_id IS DISTINCT FROM p_customer_id
    OR lower(trim(both from COALESCE(v_order.customer_email, ''))) IS DISTINCT FROM lower(trim(both from COALESCE(p_customer_email, '')))
    OR v_order.customer_name IS DISTINCT FROM p_customer_name
    OR v_order.customer_phone IS DISTINCT FROM p_customer_phone
    OR v_order.total IS DISTINCT FROM p_total
    OR v_order.subtotal IS DISTINCT FROM p_subtotal
    OR v_order.shipping_fee IS DISTINCT FROM p_shipping_fee
    OR v_order.tax_amount IS DISTINCT FROM p_tax_amount
    OR v_order.discount_amount IS DISTINCT FROM p_discount_amount
    OR v_order.amount_paid IS DISTINCT FROM p_amount_paid
    OR v_order.currency IS DISTINCT FROM p_currency
    OR v_order.order_number IS DISTINCT FROM p_order_number
    OR v_order.payment_status IS DISTINCT FROM p_payment_status
    OR v_order.payment_method IS DISTINCT FROM p_payment_method
    OR v_order.shipping_status IS DISTINCT FROM p_shipping_status
    OR v_order.invoice_type_code IS DISTINCT FROM p_invoice_type_code
    OR v_order.invoice_note IS DISTINCT FROM p_invoice_note
    OR v_order.notes IS DISTINCT FROM p_notes
    OR v_order.transaction_date IS DISTINCT FROM p_transaction_date
    OR v_order.invoice_issue_date IS DISTINCT FROM p_invoice_issue_date
    OR v_order.shipping_address IS DISTINCT FROM p_shipping_address
    OR v_item_count IS DISTINCT FROM p_item_count::bigint
    OR v_items IS DISTINCT FROM p_items
  THEN
    RETURN jsonb_build_object('status', 'stale');
  END IF;
  UPDATE public.order_notification_outbox AS n
  SET dispatch_started_at = now(), updated_at = now()
  WHERE n.id = p_outbox_id;
  RETURN jsonb_build_object('status', 'marked');
END;
$$;
REVOKE ALL ON FUNCTION public.mark_manual_document_dispatch_started(uuid, text, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, timestamptz, date, jsonb, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_manual_document_dispatch_started(uuid, text, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, timestamptz, date, jsonb, integer, jsonb)
  TO service_role;
