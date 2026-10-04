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

CREATE OR REPLACE FUNCTION private.enqueue_manual_order_document(p_order_id uuid, p_invoice_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_order_found boolean;
  v_event text;
  v_payment_status text;
  v_invoice_marked boolean;
  v_receipt_marked boolean;
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
  -- Stash the pre-reset in-flight state per event: the reset below
  -- clears markers before the re-arm runs, so the re-arm must consult
  -- this snapshot (not the live NULL marker) to spare rows whose send
  -- was already dispatched.
  SELECT
    EXISTS(SELECT 1 FROM public.order_notification_outbox AS s
      WHERE s.order_id = p_order_id AND s.event_type = 'manual_order_invoice'
        AND s.status = 'processing' AND s.dispatch_started_at IS NOT NULL),
    EXISTS(SELECT 1 FROM public.order_notification_outbox AS s
      WHERE s.order_id = p_order_id AND s.event_type = 'manual_order_receipt'
        AND s.status = 'processing' AND s.dispatch_started_at IS NOT NULL)
  INTO v_invoice_marked, v_receipt_marked;
  -- Reset in-flight markers BEFORE any eligibility exit: an edit that
  -- flips the order ineligible (cancel, import attach, contact clear,
  -- last-item delete, unsupported status) must still invalidate the
  -- marked send, or the lease check records a now-invalid document as
  -- sent. Invoice-only edits (type code, notes, terms, item VAT) reset
  -- invoice markers alone: receipts render none of them, so clearing a
  -- receipt marker would retry an identical attachment as a corrective
  -- duplicate. Otherwise every processing manual event resets, not just
  -- the newly derived one: a payment arriving mid-invoice-send flips
  -- the kind, and leaving the old invoice marker intact would record
  -- the stale invoice as sent.
  UPDATE public.order_notification_outbox AS n
  SET dispatch_started_at = NULL, updated_at = now()
  WHERE n.order_id = p_order_id
    AND (NOT p_invoice_only OR n.event_type = 'manual_order_invoice')
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
  -- A correction landing while a worker holds the row must re-arm it too:
  -- otherwise the worker records a terminal skip from its stale read and
  -- the correction has no later trigger to requeue it. Re-arming an
  -- undispatched processing row is safe — the marker is set atomically
  -- before provider dispatch, so nothing was sent, and the in-flight
  -- worker's next guarded write observes the lost claim and stands down.
  -- The undispatched test consults the pre-reset snapshot above, not the
  -- live marker: the reset already cleared it by the time this runs.
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
    WHERE public.order_notification_outbox.dispatch_started_at IS NULL
      AND public.order_notification_outbox.skip_reason IS DISTINCT FROM 'delivery_outcome_unknown'
      AND (public.order_notification_outbox.status IN ('skipped', 'failed')
        OR (public.order_notification_outbox.status = 'processing'
          AND NOT CASE public.order_notification_outbox.event_type
            WHEN 'manual_order_invoice' THEN v_invoice_marked
            ELSE v_receipt_marked END));
  -- A kind flip (paid after invoicing, or corrected back to unpaid)
  -- orphans the opposite kind's undispatched pending row: the claim
  -- withholds every event behind an earlier pending/processing
  -- sibling, so the stale row would hold the fresh document until its
  -- own retry delay expires. Retire it now with the same terminal
  -- state the worker would record on claiming it. Dispatched rows
  -- stay for the normal completion path; live processing rows stay
  -- for their guarded writes.
  UPDATE public.order_notification_outbox AS n
  SET status = 'skipped', skip_reason = 'document_state_changed',
    skipped_at = now(), next_attempt_at = NULL, last_error = NULL,
    locked_by = NULL, locked_at = NULL, updated_at = now()
  WHERE n.order_id = v_order.id
    AND n.event_type = CASE v_event
      WHEN 'manual_order_invoice' THEN 'manual_order_receipt'
      ELSE 'manual_order_invoice' END
    AND n.status = 'pending'
    AND n.dispatch_started_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_manual_order_document(uuid, boolean)
  FROM PUBLIC, anon, authenticated;

-- Rendered shipping subset, canonicalized exactly like the builders:
-- legacy mobile-admin aliases (address, postalCode) fall back onto the
-- canonical keys, and NULL/absent/'' collapse per key (the renderers
-- falsy-filter). Blanks collapse before the alias fallback — a blank
-- canonical must not shadow a populated alias like `||` does in TS.
-- Admin-only keys (name, phone, and any other key the
-- builders do not read) never reach the document, so edits confined to
-- them must not invalidate an identical render. The control-character
-- separator keeps key-boundary collisions from masking a real change.
CREATE OR REPLACE FUNCTION private.rendered_shipping_address(p_address jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT concat_ws(chr(31),
    COALESCE(NULLIF(p_address->>'address_line1', ''), NULLIF(p_address->>'address', '')),
    NULLIF(p_address->>'address_line2', ''),
    NULLIF(p_address->>'city', ''),
    NULLIF(p_address->>'state', ''),
    COALESCE(NULLIF(p_address->>'postal_code', ''), NULLIF(p_address->>'postalCode', '')),
    NULLIF(p_address->>'country', ''));
$function$;
REVOKE ALL ON FUNCTION private.rendered_shipping_address(jsonb)
  FROM PUBLIC, anon, authenticated;

-- Strict mirror of the sender's isSafeClaimDomain: same normalization
-- (trim, lower, strip trailing slashes, one trailing dot), then a
-- dotted hostname with alnum-ended labels <= 63 chars. Deliberately
-- stricter in one corner (letter-led TLD, so 1.2.3.4a fails here but
-- passes there): a strict verdict only ever falls back to the raw slug
-- compare, never to an unsafe skip.
CREATE OR REPLACE FUNCTION private.manual_document_domain_is_safe(p_domain text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_domain IS NOT NULL AND regexp_replace(
      regexp_replace(lower(btrim(p_domain)), '/+$', ''), '\.$', ''
    ) ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$';
$$;
REVOKE ALL ON FUNCTION private.manual_document_domain_is_safe(text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.enqueue_manual_document_after_order_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_both_kind_changed boolean;
  v_invoice_only_changed boolean;
BEGIN
  -- The order-scoped redemption relink sets manual_document.trusted_relink
  -- around its customer_id UPDATE: customer_id is not rendered, so the
  -- relink must not reset an in-flight marker (the accepted send would
  -- classify as document_changed_during_send, then retry into a skipped
  -- row once the token is claimed). Staff-driven customer changes do not
  -- set the flag and still invalidate below.
  IF current_setting('manual_document.trusted_relink', true) = 'on' THEN
    RETURN NEW;
  END IF;
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
  -- Shipping status prints nowhere, so only a terminal crossing (into
  -- or out of cancelled/canceled/returned/failed) re-evaluates:
  -- pending-to-shipped transitions must not reset an in-flight marker
  -- and retry an identical attachment as a corrective duplicate.
  -- Invoice-only fields (type code, notes, method, terms, FIRS) print
  -- nowhere on receipts: when nothing else changed, only invoice markers
  -- reset. Every other listed field renders on both kinds or gates
  -- eligibility, so those reset both.
  v_both_kind_changed :=
    NEW.payment_status IS DISTINCT FROM OLD.payment_status
    OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
    OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.shipping_fee IS DISTINCT FROM OLD.shipping_fee
    OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
    OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
    OR NEW.order_number IS DISTINCT FROM OLD.order_number
    OR private.rendered_shipping_address(NEW.shipping_address)
      IS DISTINCT FROM private.rendered_shipping_address(OLD.shipping_address)
    -- A scalar address fails sender validation while {} passes, yet both
    -- render empty: re-arm on any invalid-to-valid shape repair (or break)
    -- so a fixed row requeues instead of staying terminally skipped.
    OR COALESCE(jsonb_typeof(OLD.shipping_address), 'null') IN ('object', 'null')
      IS DISTINCT FROM (COALESCE(jsonb_typeof(NEW.shipping_address), 'null') IN ('object', 'null'))
    OR NEW.customer_email IS DISTINCT FROM OLD.customer_email
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
    OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
    OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.recorded_by_user_id IS DISTINCT FROM OLD.recorded_by_user_id
    OR NEW.import_job_id IS DISTINCT FROM OLD.import_job_id
    OR NEW.external_source IS DISTINCT FROM OLD.external_source
    OR (lower(btrim(COALESCE(OLD.shipping_status, ''))) IN ('cancelled', 'canceled', 'returned', 'failed'))
      IS DISTINCT FROM (lower(btrim(COALESCE(NEW.shipping_status, ''))) IN ('cancelled', 'canceled', 'returned', 'failed'));
  v_invoice_only_changed :=
    NEW.payment_method IS DISTINCT FROM OLD.payment_method
    OR NEW.invoice_type_code IS DISTINCT FROM OLD.invoice_type_code
    -- Receipts date from the completing payment, never the issue date.
    OR NEW.invoice_issue_date IS DISTINCT FROM OLD.invoice_issue_date
    -- The renderer prints invoice_note || notes trimmed: compare the
    -- resolved note so a shadowed edit resets nothing.
    OR NULLIF(btrim(COALESCE(NULLIF(OLD.invoice_note, ''), NULLIF(OLD.notes, ''))), '')
      IS DISTINCT FROM NULLIF(btrim(COALESCE(NULLIF(NEW.invoice_note, ''), NULLIF(NEW.notes, ''))), '')
    OR NEW.payment_due_date IS DISTINCT FROM OLD.payment_due_date
    OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms
    OR NEW.buyer_reference IS DISTINCT FROM OLD.buyer_reference
    OR NEW.firs_irn IS DISTINCT FROM OLD.firs_irn
    OR NEW.firs_csid IS DISTINCT FROM OLD.firs_csid;
  IF v_both_kind_changed OR v_invoice_only_changed THEN
    PERFORM private.enqueue_manual_order_document(NEW.id, NOT v_both_kind_changed);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_manual_document_after_order_update()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enqueue_manual_document_after_order_update
  AFTER UPDATE OF payment_status, amount_paid, total, subtotal, shipping_fee, tax_amount, discount_amount, order_number, shipping_address, customer_email, customer_id, customer_name, customer_phone, payment_method, invoice_type_code, invoice_note, notes, transaction_date, invoice_issue_date, payment_due_date, payment_terms, buyer_reference, firs_irn, firs_csid, created_at, currency, recorded_by_user_id, import_job_id, external_source, shipping_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_manual_document_after_order_update();

-- Ship disabled: enabling here would let rows enqueue while an older cron
-- binary (whole-batch parse) is still live, stalling the queue with 500s.
-- Activation is the deferred postdeploy migration 20260930160300, which the
-- deployer applies after draining the previous revision; until then no
-- manual rows are produced (see docs/manual-order-document-notifications.md
-- "Activation").
ALTER TABLE public.orders DISABLE TRIGGER enqueue_manual_document_after_order_update;

-- Revoke explicitly, including installations with older authenticated grants.
REVOKE ALL ON FUNCTION public.claim_order_notification_outbox(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_notification_outbox(integer, text)
  TO service_role;

-- Receipt-claim storage and the claim-creation RPC live in the follow-up
-- migration 20260930160050 (300-line rule). Merchant re-arm lives in
-- 20260930160065, and the order_items statement triggers in 20260930160070,
-- for the same reason.
