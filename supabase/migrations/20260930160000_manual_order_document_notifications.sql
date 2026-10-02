-- Existing orders are deliberately excluded: this rollout sends no historical mail.
ALTER TABLE public.orders
  ADD COLUMN manual_document_notification_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders
  ALTER COLUMN manual_document_notification_eligible SET DEFAULT true;
COMMENT ON COLUMN public.orders.manual_document_notification_eligible IS
  'New-order rollout gate for automatic manual-order documents; historical orders are not backfilled.';

ALTER TABLE public.order_notification_outbox
  DROP CONSTRAINT order_notification_outbox_event_type_check;
ALTER TABLE public.order_notification_outbox
  ADD CONSTRAINT order_notification_outbox_event_type_check CHECK (event_type IN (
    'order_shipped', 'order_delivered', 'manual_order_invoice', 'manual_order_receipt'
  ));
CREATE UNIQUE INDEX idx_order_notification_outbox_manual_document
  ON public.order_notification_outbox (order_id, event_type)
  WHERE event_type IN ('manual_order_invoice', 'manual_order_receipt');

CREATE OR REPLACE FUNCTION private.enqueue_manual_order_document(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event text;
  v_payment_status text;
BEGIN
  -- FOR NO KEY UPDATE still serializes against the claim/mark FOR SHARE
  -- locks but does not conflict with the FOR KEY SHARE locks foreign-key
  -- inserts (order_items, transactions, outbox) hold on this row, so two
  -- concurrent item batches cannot deadlock against each other here.
  SELECT o.* INTO v_order FROM public.orders AS o
  WHERE o.id = p_order_id FOR NO KEY UPDATE;
  IF NOT FOUND OR NOT v_order.manual_document_notification_eligible
    OR v_order.recorded_by_user_id IS NULL
    OR v_order.import_job_id IS NOT NULL
    -- A blank staff-entered source is absent, not imported: the sender and
    -- storefront both use truthiness, so the trigger must agree or the
    -- advertised email never queues.
    OR nullif(btrim(COALESCE(v_order.external_source, '')), '') IS NOT NULL
    OR v_order.customer_id IS NULL
    OR COALESCE(btrim(v_order.customer_email), '') = ''
    OR lower(btrim(COALESCE(v_order.shipping_status, ''))) IN ('cancelled', 'canceled', 'returned', 'failed')
    OR NOT EXISTS (SELECT 1 FROM public.order_items AS oi WHERE oi.order_id = v_order.id)
  THEN RETURN; END IF;
  -- The column has no status constraint, so legacy spellings (Paid, PAID,
  -- padded, spaced) normalize like the sender and storefront guards:
  -- trim, lowercase, and fold internal whitespace to underscores.
  v_payment_status := regexp_replace(
    lower(btrim(COALESCE(v_order.payment_status, ''))), '\s+', '_', 'g'
  );
  -- A fully-covered balance is substantively paid even when staff left a
  -- non-paid label (e.g. an over-amount partial): queue the receipt the
  -- customer is owed, never a zero-balance invoice; otherwise the archive
  -- shows a document the trigger never queues.
  IF v_order.amount_paid >= v_order.total
    AND v_payment_status IN ('paid', 'unpaid', 'pending', 'partially_paid') THEN
    v_event := 'manual_order_receipt';
  ELSIF v_payment_status IN ('unpaid', 'pending', 'partially_paid') THEN
    v_event := 'manual_order_invoice';
  ELSE RETURN; END IF;

  -- A later correction re-arms a terminal row the worker gave up on so the
  -- customer gets the corrected document without staff deleting rows: only
  -- skipped/failed rows that never started dispatch come back to pending.
  -- Sent rows never re-arm (resend stays deliberate), and rows that may
  -- already have dispatched (delivery_outcome_unknown, dispatch started)
  -- stay terminal to preserve at-most-once delivery.
  INSERT INTO public.order_notification_outbox (
    merchant_id, order_id, event_type, fulfillment_cycle_id, metadata
  ) VALUES (
    v_order.merchant_id, v_order.id, v_event,
    v_order.fulfillment_notification_cycle_id,
    jsonb_build_object('source', 'manual_order_document')
  ) ON CONFLICT (order_id, event_type)
    WHERE event_type IN ('manual_order_invoice', 'manual_order_receipt')
    DO UPDATE SET status = 'pending', attempt_count = 0, next_attempt_at = NULL,
      locked_by = NULL, locked_at = NULL, last_error = NULL,
      skip_reason = NULL, skipped_at = NULL, updated_at = now()
    WHERE public.order_notification_outbox.status IN ('skipped', 'failed')
      AND public.order_notification_outbox.dispatch_started_at IS NULL
      AND public.order_notification_outbox.skip_reason IS DISTINCT FROM 'delivery_outcome_unknown';
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_manual_order_document(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.enqueue_manual_documents_after_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order_id uuid;
BEGIN
  -- The statement-level trigger observes the whole item batch, not its first row.
  FOR v_order_id IN SELECT DISTINCT order_id FROM inserted_items ORDER BY order_id LOOP
    PERFORM private.enqueue_manual_order_document(v_order_id);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_manual_documents_after_items()
  FROM PUBLIC, anon, authenticated;
-- AFTER UPDATE keeps item corrections symmetric with order corrections: a
-- stale/failed dispatch unblocked by an item edit re-arms the same way an
-- order-field correction does. AFTER DELETE covers the partial correction:
-- removing one invalid line from a multi-item order leaves a valid nonempty
-- order that must re-evaluate too, not just the wipe-and-reinsert cycle.
-- Transition tables cannot be specified on multi-event triggers, so each
-- event gets its own trigger over the shared function (NEW TABLE for
-- INSERT/UPDATE, OLD TABLE for DELETE).
CREATE TRIGGER enqueue_manual_documents_after_items
  AFTER INSERT ON public.order_items REFERENCING NEW TABLE AS inserted_items
  FOR EACH STATEMENT EXECUTE FUNCTION private.enqueue_manual_documents_after_items();
CREATE TRIGGER enqueue_manual_documents_after_item_updates
  AFTER UPDATE ON public.order_items REFERENCING NEW TABLE AS inserted_items
  FOR EACH STATEMENT EXECUTE FUNCTION private.enqueue_manual_documents_after_items();
CREATE TRIGGER enqueue_manual_documents_after_item_deletes
  AFTER DELETE ON public.order_items REFERENCING OLD TABLE AS inserted_items
  FOR EACH STATEMENT EXECUTE FUNCTION private.enqueue_manual_documents_after_items();

CREATE OR REPLACE FUNCTION private.enqueue_manual_document_after_order_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Payment progress, total corrections, manual-marking transitions, and
  -- late customer-contact corrections all re-evaluate eligibility; an order
  -- created without an email/customer still sends once staff fix the contact
  -- details, and a touched total re-queues a document that a correction
  -- invalidated. Every other order field the sender strictly validates
  -- (money breakdown, order number, shipping address) re-arms the same way
  -- when staff repair a database-permitted invalid value; the remaining
  -- snapshot fields are either immutable (ids), unvalidated-nullable
  -- (names, notes, dates, method), or covered by the item triggers.
  -- Re-evaluation is idempotent, so shipping transitions that change
  -- nothing simply re-confirm the existing row.
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
    OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
    OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.shipping_fee IS DISTINCT FROM OLD.shipping_fee
    OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
    OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
    OR NEW.order_number IS DISTINCT FROM OLD.order_number
    OR NEW.shipping_address IS DISTINCT FROM OLD.shipping_address
    OR NEW.customer_email IS DISTINCT FROM OLD.customer_email
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.recorded_by_user_id IS DISTINCT FROM OLD.recorded_by_user_id
    OR NEW.import_job_id IS DISTINCT FROM OLD.import_job_id
    OR NEW.external_source IS DISTINCT FROM OLD.external_source
    OR NEW.shipping_status IS DISTINCT FROM OLD.shipping_status THEN
    PERFORM private.enqueue_manual_order_document(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_manual_document_after_order_update()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enqueue_manual_document_after_order_update
  AFTER UPDATE OF payment_status, amount_paid, total, subtotal, shipping_fee, tax_amount, discount_amount, order_number, shipping_address, customer_email, customer_id, recorded_by_user_id, import_job_id, external_source, shipping_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_manual_document_after_order_update();

CREATE OR REPLACE FUNCTION private.rearm_manual_documents_after_merchant_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Completing a merchant profile (slug, VAT rate) re-arms rows the worker
  -- terminally skipped as merchant_validation_failed: only order and item
  -- changes invoke the order re-enqueue, so without this the corrected
  -- document is permanently lost. Other skip reasons keep their own re-arm
  -- paths; sent and possibly-dispatched rows stay terminal. The worker
  -- re-validates the merchant on the next attempt, so a still-invalid
  -- profile simply skips again until staff finish the correction.
  UPDATE public.order_notification_outbox AS n
  SET status = 'pending', attempt_count = 0, next_attempt_at = NULL,
    locked_by = NULL, locked_at = NULL, last_error = NULL,
    skip_reason = NULL, skipped_at = NULL, updated_at = now()
  WHERE n.merchant_id = NEW.id
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    AND n.status = 'skipped'
    AND n.skip_reason = 'merchant_validation_failed'
    AND n.dispatch_started_at IS NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.rearm_manual_documents_after_merchant_update()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER rearm_manual_documents_after_merchant_update
  AFTER UPDATE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION private.rearm_manual_documents_after_merchant_update();

-- Ship disabled: enabling here would let rows enqueue while an older cron
-- binary (whole-batch parse) is still live, stalling the queue with 500s.
-- Activation is the deferred postdeploy migration 20260930160300, which the
-- deployer applies after draining the previous revision; until then no
-- manual rows are produced (see docs/manual-order-document-notifications.md
-- "Activation").
ALTER TABLE public.order_items DISABLE TRIGGER enqueue_manual_documents_after_items;
ALTER TABLE public.order_items DISABLE TRIGGER enqueue_manual_documents_after_item_updates;
ALTER TABLE public.order_items DISABLE TRIGGER enqueue_manual_documents_after_item_deletes;
ALTER TABLE public.orders DISABLE TRIGGER enqueue_manual_document_after_order_update;
ALTER TABLE public.merchants DISABLE TRIGGER rearm_manual_documents_after_merchant_update;

-- Revoke explicitly, including installations with older authenticated grants.
REVOKE ALL ON FUNCTION public.claim_order_notification_outbox(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_notification_outbox(integer, text)
  TO service_role;

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
