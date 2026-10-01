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
BEGIN
  SELECT o.* INTO v_order FROM public.orders AS o
  WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT v_order.manual_document_notification_eligible
    OR v_order.recorded_by_user_id IS NULL
    OR v_order.import_job_id IS NOT NULL OR v_order.external_source IS NOT NULL
    OR v_order.customer_id IS NULL
    OR COALESCE(btrim(v_order.customer_email), '') = ''
    OR COALESCE(v_order.shipping_status, '') IN ('cancelled', 'canceled', 'returned', 'failed')
    OR NOT EXISTS (SELECT 1 FROM public.order_items AS oi WHERE oi.order_id = v_order.id)
  THEN RETURN; END IF;
  IF v_order.payment_status = 'paid' AND v_order.amount_paid >= v_order.total THEN
    v_event := 'manual_order_receipt';
  ELSIF v_order.payment_status IN ('unpaid', 'pending', 'partially_paid') THEN
    v_event := 'manual_order_invoice';
  ELSE RETURN; END IF;

  INSERT INTO public.order_notification_outbox (
    merchant_id, order_id, event_type, fulfillment_cycle_id, metadata
  ) VALUES (
    v_order.merchant_id, v_order.id, v_event,
    v_order.fulfillment_notification_cycle_id,
    jsonb_build_object('source', 'manual_order_document')
  ) ON CONFLICT (order_id, event_type)
    WHERE event_type IN ('manual_order_invoice', 'manual_order_receipt') DO NOTHING;
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
CREATE TRIGGER enqueue_manual_documents_after_items
  AFTER INSERT ON public.order_items REFERENCING NEW TABLE AS inserted_items
  FOR EACH STATEMENT EXECUTE FUNCTION private.enqueue_manual_documents_after_items();

CREATE OR REPLACE FUNCTION private.enqueue_manual_document_after_order_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Payment progress and late customer-contact corrections both re-evaluate
  -- eligibility; an order created without an email/customer still sends once
  -- staff fix the contact details.
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
    OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
    OR NEW.customer_email IS DISTINCT FROM OLD.customer_email
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    PERFORM private.enqueue_manual_order_document(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_manual_document_after_order_update()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enqueue_manual_document_after_order_update
  AFTER UPDATE OF payment_status, amount_paid, customer_email, customer_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_manual_document_after_order_update();

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
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('status', 'skipped');
  END IF;
  SELECT n.* INTO v_notification FROM public.order_notification_outbox AS n
  WHERE n.id = p_outbox_id AND n.status = 'processing'
    AND n.locked_by = p_claim_owner AND n.dispatch_started_at IS NULL
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'skipped'); END IF;

  SELECT o.* INTO v_order FROM public.orders AS o
  WHERE o.id = v_notification.order_id AND o.merchant_id = v_notification.merchant_id
  FOR SHARE;
  IF NOT FOUND OR NOT v_order.manual_document_notification_eligible
    OR v_order.recorded_by_user_id IS NULL
    OR v_order.import_job_id IS NOT NULL OR v_order.external_source IS NOT NULL
    OR COALESCE(btrim(v_order.customer_email), '') = ''
    OR COALESCE(v_order.shipping_status, '') IN ('cancelled', 'canceled', 'returned', 'failed')
    OR NOT EXISTS (SELECT 1 FROM public.order_items AS oi WHERE oi.order_id = v_order.id)
    OR v_order.total IS NULL OR v_order.amount_paid IS NULL
    OR (v_notification.event_type = 'manual_order_receipt'
      AND (v_order.payment_status IS DISTINCT FROM 'paid' OR v_order.amount_paid < v_order.total))
    OR (v_notification.event_type = 'manual_order_invoice'
      AND COALESCE(v_order.payment_status, '') NOT IN ('unpaid', 'pending', 'partially_paid'))
  THEN RETURN jsonb_build_object('status', 'skipped'); END IF;

  SELECT c.* INTO v_customer FROM public.customers AS c
  WHERE c.id = v_order.customer_id AND c.merchant_id = v_order.merchant_id
    AND c.deleted_at IS NULL
    AND lower(btrim(c.email)) = lower(btrim(v_order.customer_email))
  FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'skipped'); END IF;

  INSERT INTO public.receipt_claims (
    merchant_id, manual_notification_id, customer_id, customer_email, customer_name, token_hash
  ) VALUES (
    v_order.merchant_id, v_notification.id, v_customer.id,
    v_order.customer_email, v_order.customer_name, p_token_hash
  ) ON CONFLICT (manual_notification_id) WHERE manual_notification_id IS NOT NULL
  DO UPDATE SET token_hash = EXCLUDED.token_hash,
    expires_at = now() + interval '90 days', updated_at = now()
  WHERE public.receipt_claims.claimed_at IS NULL
    AND public.receipt_claims.notification_sent_at IS NULL
    AND public.receipt_claims.customer_id = EXCLUDED.customer_id
    AND public.receipt_claims.customer_email_normalized = EXCLUDED.customer_email_normalized
  RETURNING id INTO v_claim_id;
  IF v_claim_id IS NULL THEN RETURN jsonb_build_object('status', 'skipped'); END IF;
  INSERT INTO public.receipt_claim_orders (receipt_claim_id, order_id)
  VALUES (v_claim_id, v_order.id) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('status', 'created', 'claim_id', v_claim_id,
    'customer_id', v_customer.id, 'customer_email', v_order.customer_email);
END;
$$;
REVOKE ALL ON FUNCTION public.create_manual_order_document_claim(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_order_document_claim(uuid, text, text)
  TO service_role;
