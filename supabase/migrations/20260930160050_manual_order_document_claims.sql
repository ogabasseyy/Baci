-- Manual-order receipt-claim storage, split from
-- 20260930160000_manual_order_document_notifications.sql (300-line rule).
-- Applies after it: extends receipt_claims with the manual-notification
-- source and adds the claim-creation RPC the worker calls before dispatch.
-- Safe predeploy: DROP NOT NULL only relaxes, the new column is nullable,
-- every existing row satisfies the XOR source CHECK via its import_job_id,
-- and the claim RPC is additive (no live signature changes).
ALTER TABLE public.receipt_claims ALTER COLUMN import_job_id DROP NOT NULL;
ALTER TABLE public.receipt_claims
  ADD COLUMN manual_notification_id uuid
    REFERENCES public.order_notification_outbox(id) ON DELETE CASCADE,
  ADD COLUMN previous_token_hash text,
  ADD COLUMN delivered_token_hash text,
  ADD CONSTRAINT receipt_claims_exact_source CHECK (
    (import_job_id IS NOT NULL AND manual_notification_id IS NULL)
    OR (import_job_id IS NULL AND manual_notification_id IS NOT NULL)
  );
CREATE UNIQUE INDEX idx_receipt_claims_manual_notification
  ON public.receipt_claims (manual_notification_id) WHERE manual_notification_id IS NOT NULL;
-- Previous-token grace: every retry rotates to a fresh bearer, which would
-- orphan an already-mailed link when the earlier attempt was actually
-- accepted (unknown delivery outcome). Rotation stashes the replaced hash
-- here so redemption/preview honor the newest mailed link plus its
-- predecessor; the row expiry still bounds both. Unique so a
-- previous-hash lookup can never match two rows.
CREATE UNIQUE INDEX idx_receipt_claims_previous_token_hash
  ON public.receipt_claims (previous_token_hash) WHERE previous_token_hash IS NOT NULL;
-- Last known-delivered hash, advanced only by the sent marker (which runs
-- solely post-acceptance): rotation shifts previous_token_hash on every
-- pre-dispatch retry, so a rejected corrective attempt would otherwise
-- orphan the accepted mail's token before any replacement is delivered.
-- Rotation never touches this column; a newer acceptance overwrites it.
CREATE UNIQUE INDEX idx_receipt_claims_delivered_token_hash
  ON public.receipt_claims (delivered_token_hash) WHERE delivered_token_hash IS NOT NULL;
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
  -- Lock order: claim, then order, then customer, then outbox. Order
  -- before outbox matches the order-update trigger path (which holds the
  -- order while enqueue waits on the outbox); customer before outbox
  -- matches the customer-restore/delete trigger paths (which hold the
  -- customer while re-arming the outbox) — locking the outbox first here
  -- deadlocks against a concurrent restore of the same customer. The
  -- merchant scoping is revalidated after the outbox lock because the
  -- outbox row is unread yet.
  -- Pre-lock the existing claim (if any) BEFORE the order and customer:
  -- redemption locks claim-then-order-then-customer, so any later claim
  -- lock deadlocks when a corrective retry races the recipient's
  -- redemption (and a lost redemption then 404s after rotation). Keyed
  -- by the outbox id directly so no read precedes it; fresh creates lock
  -- nothing yet and serialize on the unique index instead.
  PERFORM 1 FROM public.receipt_claims AS rc
  WHERE rc.manual_notification_id = p_outbox_id FOR UPDATE;
  SELECT o.* INTO v_order FROM public.orders AS o
  WHERE o.id = (SELECT n.order_id FROM public.order_notification_outbox AS n WHERE n.id = p_outbox_id)
  FOR SHARE;
  -- Customer before the outbox (see above): keyed by the order's
  -- staff-selected identity, independent of the outbox row.
  SELECT c.* INTO v_customer FROM public.customers AS c
  WHERE c.id = v_order.customer_id AND c.merchant_id = v_order.merchant_id
    AND c.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'skipped'); END IF;
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

  -- v_customer was bound above (before the outbox lock): staff-selected
  -- customer identity, not email equality — the order's email is the
  -- contact channel staff entered, and requiring the customers row to
  -- agree would strand legitimate late corrections (verified sign-in
  -- still gates redemption, and the order email stays the claim
  -- recipient).

  INSERT INTO public.receipt_claims (
    merchant_id, manual_notification_id, customer_id, customer_email, customer_name, token_hash
  ) VALUES (
    v_order.merchant_id, v_notification.id, v_customer.id,
    v_order.customer_email, v_order.customer_name, p_token_hash
  ) ON CONFLICT (manual_notification_id) WHERE manual_notification_id IS NOT NULL
  -- Every arrival here is a legitimate (re)send — completed sends never
  -- reach rotation (the processing gate above) — so the retry's emailed
  -- link must match the stored hash even when the customer already
  -- redeemed the stale link. Otherwise the corrected send terminally
  -- skips and the stale PDF is never corrected. Rotation preserves
  -- claimed_at (redemption serves live data and stays re-openable), so
  -- the customer keeps working access through the fresh link while the
  -- emailed stale link survives one rotation via previous_token_hash (a
  -- retry must not orphan a mailed link whose send outcome was unknown)
  -- unless staff corrected the order to a different recipient, in which
  -- case the stale redemption is cleared so the fresh link is not
  -- already_used (the row-current email check still fails the old bearer
  -- closed on the graced hash).
  DO UPDATE SET token_hash = EXCLUDED.token_hash,
    previous_token_hash = receipt_claims.token_hash,
    customer_id = EXCLUDED.customer_id,
    customer_email = EXCLUDED.customer_email,
    customer_name = EXCLUDED.customer_name,
    claimed_at = CASE WHEN receipt_claims.customer_id IS DISTINCT FROM EXCLUDED.customer_id
        OR lower(btrim(receipt_claims.customer_email)) IS DISTINCT FROM lower(btrim(EXCLUDED.customer_email))
      THEN NULL ELSE receipt_claims.claimed_at END,
    claimed_by_user_id = CASE WHEN receipt_claims.customer_id IS DISTINCT FROM EXCLUDED.customer_id
        OR lower(btrim(receipt_claims.customer_email)) IS DISTINCT FROM lower(btrim(EXCLUDED.customer_email))
      THEN NULL ELSE receipt_claims.claimed_by_user_id END,
    expires_at = now() + interval '90 days', updated_at = now()
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
