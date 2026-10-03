-- Existing orders are deliberately excluded: this rollout sends no historical mail.
-- Safe predeploy: the event-type CHECK only widens (old values still valid), the
-- new column defaults new rows to eligible while every trigger below ships
-- DISABLED (60300 enables them post-deploy), and the partial unique index
-- matches no pre-existing rows.
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
  v_order_found boolean;
  v_event text;
  v_payment_status text;
BEGIN
  -- FOR NO KEY UPDATE still serializes against the claim/mark FOR SHARE
  -- locks but does not conflict with the FOR KEY SHARE locks foreign-key
  -- inserts (order_items, transactions, outbox) hold on this row, so two
  -- concurrent item batches cannot deadlock against each other here.
  SELECT o.* INTO v_order FROM public.orders AS o
  WHERE o.id = p_order_id FOR NO KEY UPDATE;
  -- FOUND is set by every SQL statement, so capture the lock result
  -- before the reset below overwrites it.
  v_order_found := FOUND;
  -- Reset in-flight markers BEFORE any eligibility exit: an edit that
  -- flips the order ineligible (cancel, import attach, contact clear,
  -- last-item delete, unsupported status) must still invalidate the
  -- marked send, or the lease check records a now-invalid document as
  -- sent. Every processing manual event resets, not just the newly
  -- derived one: a payment arriving mid-invoice-send flips the kind,
  -- and leaving the old invoice marker intact would record the stale
  -- invoice as sent.
  UPDATE public.order_notification_outbox AS n
  SET dispatch_started_at = NULL, updated_at = now()
  WHERE n.order_id = p_order_id
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL;
  IF NOT v_order_found OR NOT v_order.manual_document_notification_eligible
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
  FOR v_order_id IN (
    SELECT order_id FROM inserted_items
    UNION SELECT order_id FROM removed_items
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

CREATE OR REPLACE FUNCTION private.enqueue_manual_document_after_order_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Payment progress, total corrections, manual-marking transitions, and
  -- late customer-contact corrections all re-evaluate eligibility; an order
  -- created without an email/customer still sends once staff fix the contact
  -- details, and a touched total re-queues a document that a correction
  -- invalidated. Every other order field the dispatch snapshot compares
  -- (money breakdown, currency, order number, shipping address, recipient
  -- names, payment method, invoice type/note, notes, transaction and issue
  -- dates, creation timestamp) re-arms the same way when staff repair
  -- a database-permitted invalid value, and — equally important —
  -- invalidates an in-flight
  -- send when staff edit a rendered field the snapshot already covered;
  -- only immutable ids and item-owned fields stay outside this list.
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
    OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
    OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
    OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
    OR NEW.invoice_type_code IS DISTINCT FROM OLD.invoice_type_code
    OR NEW.invoice_note IS DISTINCT FROM OLD.invoice_note
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
    OR NEW.invoice_issue_date IS DISTINCT FROM OLD.invoice_issue_date
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.currency IS DISTINCT FROM OLD.currency
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
  AFTER UPDATE OF payment_status, amount_paid, total, subtotal, shipping_fee, tax_amount, discount_amount, order_number, shipping_address, customer_email, customer_id, customer_name, customer_phone, payment_method, invoice_type_code, invoice_note, notes, transaction_date, invoice_issue_date, created_at, currency, recorded_by_user_id, import_job_id, external_source, shipping_status ON public.orders
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
  -- A snapshot-relevant merchant edit landing mid-dispatch resets every
  -- processing marker so the lease check aborts instead of recording a
  -- stale document as sent. Rendered branding (logo, colors) and the
  -- From display name invalidate alongside issuer/contact/payment fields.
  IF OLD.slug IS DISTINCT FROM NEW.slug
    OR OLD.business_name IS DISTINCT FROM NEW.business_name
    OR OLD.legal_entity_name IS DISTINCT FROM NEW.legal_entity_name
    OR OLD.business_address IS DISTINCT FROM NEW.business_address
    OR OLD.registered_address IS DISTINCT FROM NEW.registered_address
    OR OLD.cac_rc_number IS DISTINCT FROM NEW.cac_rc_number
    OR OLD.tax_identification_number IS DISTINCT FROM NEW.tax_identification_number
    OR OLD.vat_registration_status IS DISTINCT FROM NEW.vat_registration_status
    OR OLD.vat_rate IS DISTINCT FROM NEW.vat_rate
    OR OLD.support_email IS DISTINCT FROM NEW.support_email
    OR OLD.support_phone IS DISTINCT FROM NEW.support_phone
    OR OLD.phone IS DISTINCT FROM NEW.phone
    OR OLD.bank_code IS DISTINCT FROM NEW.bank_code
    OR OLD.bank_account_number IS DISTINCT FROM NEW.bank_account_number
    OR OLD.bank_name IS DISTINCT FROM NEW.bank_name
    OR OLD.bank_account_name IS DISTINCT FROM NEW.bank_account_name
    OR OLD.email_sender_name IS DISTINCT FROM NEW.email_sender_name
    OR OLD.logo_url IS DISTINCT FROM NEW.logo_url
    OR OLD.brand_colors IS DISTINCT FROM NEW.brand_colors
  THEN
    UPDATE public.order_notification_outbox AS n
    SET dispatch_started_at = NULL, updated_at = now()
    WHERE n.merchant_id = NEW.id
      AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
      AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL;
  END IF;
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

-- Receipt-claim storage and the claim-creation RPC live in the follow-up
-- migration 20260930160050 (300-line rule).
