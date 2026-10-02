-- Manual-order receipt-claim storage, split from
-- 20260930160000_manual_order_document_notifications.sql (300-line rule).
-- Applies after it: extends receipt_claims with the manual-notification
-- source and adds the claim-creation RPC the worker calls before dispatch.
ALTER TABLE public.receipt_claims ALTER COLUMN import_job_id DROP NOT NULL;
ALTER TABLE public.receipt_claims
  ADD COLUMN manual_notification_id uuid
    REFERENCES public.order_notification_outbox(id) ON DELETE CASCADE,
  ADD CONSTRAINT receipt_claims_exact_source CHECK (
    (import_job_id IS NOT NULL AND manual_notification_id IS NULL)
    OR (import_job_id IS NULL AND manual_notification_id IS NOT NULL)
  );
CREATE UNIQUE INDEX idx_receipt_claims_manual_notification
  ON public.receipt_claims (manual_notification_id) WHERE manual_notification_id IS NOT NULL;
COMMENT ON TABLE public.receipt_claims IS
  'Hashed claim links for imported and manual order document emails; verified purchase-email sign-in is required.';
COMMENT ON TABLE public.receipt_claim_orders IS
  'Tenant/customer-scoped orders associated with a receipt or invoice claim email.';

CREATE OR REPLACE FUNCTION public.create_manual_order_document_claim(
  p_outbox_id uuid, p_claim_owner text, p_token_hash text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_notification public.order_notification_outbox%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_claim_id uuid;
  v_payment_status text;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('status', 'skipped');
  END IF;
  -- Lock the order before the outbox, matching the order-update trigger path
  -- (which holds the order row while enqueue waits on the outbox): the reverse
  -- order deadlocks against concurrent staff edits. The merchant scoping is
  -- revalidated after both locks are held because the outbox row is unread yet.
  SELECT o.* INTO v_order FROM public.orders AS o
  WHERE o.id = (SELECT n.order_id FROM public.order_notification_outbox AS n WHERE n.id = p_outbox_id)
  FOR SHARE;
  SELECT n.* INTO v_notification FROM public.order_notification_outbox AS n
  WHERE n.id = p_outbox_id AND n.status = 'processing'
    AND n.locked_by = p_claim_owner AND n.dispatch_started_at IS NULL
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'skipped'); END IF;
  IF v_order IS NULL OR v_order.merchant_id IS DISTINCT FROM v_notification.merchant_id THEN
    RETURN jsonb_build_object('status', 'skipped');
  END IF;
  -- Fold internal whitespace exactly like the enqueue path: the claim
  -- re-check must agree with the trigger that queued the row.
  v_payment_status := regexp_replace(
    lower(btrim(COALESCE(v_order.payment_status, ''))), '\s+', '_', 'g'
  );
  IF NOT v_order.manual_document_notification_eligible
    OR v_order.recorded_by_user_id IS NULL
    OR v_order.import_job_id IS NOT NULL
    OR nullif(btrim(COALESCE(v_order.external_source, '')), '') IS NOT NULL
    OR COALESCE(btrim(v_order.customer_email), '') = ''
    OR lower(btrim(COALESCE(v_order.shipping_status, ''))) IN ('cancelled', 'canceled', 'returned', 'failed')
    OR NOT EXISTS (SELECT 1 FROM public.order_items AS oi WHERE oi.order_id = v_order.id)
    OR v_order.total IS NULL OR v_order.amount_paid IS NULL
    OR (v_notification.event_type = 'manual_order_receipt'
      AND (v_payment_status NOT IN ('paid', 'unpaid', 'pending', 'partially_paid')
        OR v_order.amount_paid < v_order.total))
    OR (v_notification.event_type = 'manual_order_invoice'
      AND (v_payment_status NOT IN ('unpaid', 'pending', 'partially_paid')
        OR v_order.amount_paid >= v_order.total))
  THEN RETURN jsonb_build_object('status', 'skipped'); END IF;

  -- Bind by staff-selected customer identity, not email equality: the order's
  -- email is the contact channel staff entered, and requiring the customers
  -- row to agree would strand legitimate late corrections (verified sign-in
  -- still gates redemption, and the order email stays the claim recipient).
  SELECT c.* INTO v_customer FROM public.customers AS c
  WHERE c.id = v_order.customer_id AND c.merchant_id = v_order.merchant_id
    AND c.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'skipped'); END IF;

  INSERT INTO public.receipt_claims (
    merchant_id, manual_notification_id, customer_id, customer_email, customer_name, token_hash
  ) VALUES (
    v_order.merchant_id, v_notification.id, v_customer.id,
    v_order.customer_email, v_order.customer_name, p_token_hash
  ) ON CONFLICT (manual_notification_id) WHERE manual_notification_id IS NOT NULL
  -- An unsent, unclaimed row adopts a corrected recipient instead of
  -- terminally skipping: nothing went out and nobody linked, so the new
  -- identity (and rotated token) is exactly the corrected send.
  DO UPDATE SET token_hash = EXCLUDED.token_hash,
    customer_id = EXCLUDED.customer_id,
    customer_email = EXCLUDED.customer_email,
    customer_name = EXCLUDED.customer_name,
    expires_at = now() + interval '90 days', updated_at = now()
  WHERE public.receipt_claims.claimed_at IS NULL
    AND public.receipt_claims.notification_sent_at IS NULL
  RETURNING id INTO v_claim_id;
  IF v_claim_id IS NULL THEN RETURN jsonb_build_object('status', 'skipped'); END IF;
  INSERT INTO public.receipt_claim_orders (receipt_claim_id, order_id)
  VALUES (v_claim_id, v_order.id) ON CONFLICT DO NOTHING;
  -- Snapshot the validated live row so the worker can abort when the order
  -- changed between its read and this claim instead of sending stale totals.
  RETURN jsonb_build_object('status', 'created', 'claim_id', v_claim_id,
    'customer_id', v_customer.id, 'customer_email', v_order.customer_email,
    'order_total', v_order.total, 'order_amount_paid', v_order.amount_paid,
    'order_item_count', (SELECT count(*) FROM public.order_items AS oi WHERE oi.order_id = v_order.id),
    'order_payment_status', v_order.payment_status);
END;
$$;
REVOKE ALL ON FUNCTION public.create_manual_order_document_claim(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_order_document_claim(uuid, text, text)
  TO service_role;
