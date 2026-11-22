CREATE FUNCTION private.is_paid_order_amendment_reversing(a private.paid_order_amendments)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT a.state = 'reversed' AND NOT EXISTS (
    SELECT 1 FROM private.paid_order_amendment_revisions r WHERE r.amendment_id = a.id AND r.revision = 2
  );
$$;

CREATE OR REPLACE FUNCTION private.guard_paid_order_amendment_order_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  top_up numeric;
BEGIN
  SELECT * INTO a FROM private.paid_order_amendments WHERE order_id = OLD.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF private.is_paid_order_amendment_reversing(a)
    AND NEW.amount_paid IS NOT DISTINCT FROM OLD.amount_paid
    AND NEW.shipping_status IS NOT DISTINCT FROM OLD.shipping_status
    AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at THEN RETURN NEW; END IF;
  IF a.hold_fulfillment AND (
    NEW.shipping_status IS DISTINCT FROM OLD.shipping_status
    OR NEW.shipment_id IS DISTINCT FROM OLD.shipment_id
    OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    OR NEW.shipment_booking_lock_token IS DISTINCT FROM OLD.shipment_booking_lock_token
    OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
    OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
  ) THEN RAISE EXCEPTION 'amendment_hold'; END IF;
  IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN
    SELECT t.amount INTO top_up FROM private.paid_order_bank_evidence e
      JOIN public.transactions t ON t.id = e.transaction_id
    WHERE e.order_id = a.order_id AND e.allocation = 'top_up';
    IF a.state <> 'settled' OR OLD.payment_status <> 'partially_paid'
      OR NEW.payment_status <> 'paid' OR top_up IS NULL
      OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid + top_up
      OR NEW.amount_paid IS DISTINCT FROM OLD.total THEN RAISE EXCEPTION 'amendment_hold'; END IF;
  END IF;
  IF NEW.total IS DISTINCT FROM OLD.total OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
    OR NEW.selected_quote_id IS DISTINCT FROM OLD.selected_quote_id
    OR NEW.shipping_address IS DISTINCT FROM OLD.shipping_address THEN
    RAISE EXCEPTION 'amendment_hold';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_paid_order_amendment_line_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old_order uuid;
  v_new_order uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old_order := OLD.order_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_new_order := NEW.order_id; END IF;
  IF TG_OP = 'UPDATE' AND v_old_order = v_new_order AND (
    to_jsonb(NEW) - 'fulfillment_data' = to_jsonb(OLD) - 'fulfillment_data'
  ) THEN
    IF EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = v_old_order AND hold_fulfillment) THEN
      RAISE EXCEPTION 'amendment_hold';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND v_old_order = v_new_order AND EXISTS (
    SELECT 1 FROM private.paid_order_amendments a WHERE a.order_id = v_old_order
      AND private.is_paid_order_amendment_reversing(a)
  ) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id IN (v_old_order, v_new_order)) THEN
    RAISE EXCEPTION 'amendment_hold';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.paid_order_amendment_cancel_funding_matches(p_order_id uuid,p_total numeric,p_gross numeric)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.paid_order_amendments a WHERE a.order_id = p_order_id
    AND (a.state = 'cancelled_for_recovery' OR (
      a.state = 'settled' AND EXISTS (
        SELECT 1 FROM private.paid_order_amendment_refunds r
        JOIN private.paid_order_amendment_adjustments adjustment ON adjustment.refund_id = r.id
        WHERE r.amendment_id = a.id AND r.state = 'processed'
          AND p_gross - r.amount_minor::numeric / 100 = p_total
      )
    ))
  );
$$;
REVOKE ALL ON FUNCTION private.is_paid_order_amendment_reversing(private.paid_order_amendments),
  private.paid_order_amendment_cancel_funding_matches(uuid,numeric,numeric)
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the ordinary cancellation workflow and compare net funding for an amended sale.
CREATE OR REPLACE FUNCTION public.cancel_order_as_merchant(
  p_order_id uuid,
  p_reason text DEFAULT NULL,
  p_refund_mode text DEFAULT 'automatic'
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_order record;
  v_reason text := NULLIF(btrim(p_reason), '');
  v_refund_mode text := COALESCE(NULLIF(btrim(p_refund_mode), ''), 'automatic');
  v_wallet_reversed numeric := 0;
  v_savings_reversed numeric := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_too_long' USING ERRCODE = '22001';
  END IF;
  IF v_refund_mode NOT IN ('automatic', 'manual') THEN
    RAISE EXCEPTION 'invalid_refund_mode' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id, 0));
  SELECT o.merchant_id, o.shipping_status, o.cancelled_at,
         o.payment_status, o.amount_paid, o.total,
         o.cancellation_reason, o.cancelled_by, o.cancellation_refund_mode
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.merchants m
       WHERE m.id = v_order.merchant_id AND m.user_id = v_actor
    )
    OR public.check_staff_permission(
      v_actor, v_order.merchant_id, 'orders', 'edit'
    )
  ) THEN
    RAISE EXCEPTION 'order_cancel_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Skipping the automatic refund leaves the customer charged, so it needs
  -- the same authority as recording a refund: the owner or orders.refund.
  IF v_refund_mode = 'manual' AND NOT (
    EXISTS (
      SELECT 1 FROM public.merchants m
       WHERE m.id = v_order.merchant_id AND m.user_id = v_actor
    )
    OR public.check_staff_permission(
      v_actor, v_order.merchant_id, 'orders', 'refund'
    )
  ) THEN
    RAISE EXCEPTION 'order_cancel_refund_forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_order.shipping_status IN ('cancelled', 'canceled')
     OR v_order.cancelled_at IS NOT NULL THEN
    RETURN false;
  END IF;
  IF v_order.shipping_status IN (
    'shipped', 'out_for_delivery', 'delivered', 'completed', 'returned'
  ) THEN
    RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE = 'P0001';
  END IF;
  IF private.merchant_cancel_payment_in_flight(p_order_id, v_order.merchant_id) THEN
    RAISE EXCEPTION 'payment_capture_in_flight' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.payment_status = 'paid'
     AND v_order.amount_paid IS DISTINCT FROM v_order.total
     AND NOT private.paid_order_amendment_cancel_funding_matches(p_order_id,v_order.total,v_order.amount_paid) THEN
    RAISE EXCEPTION 'paid_order_ledger_inconsistent' USING ERRCODE = 'P0001';
  END IF;

  PERFORM private.transition_verified_abandoned_captures_for_cancel(
    p_order_id, v_order.merchant_id
  );

  UPDATE public.orders
     SET shipping_status = 'cancelled', cancelled_at = now(),
         cancellation_reason = v_reason, cancelled_by = 'merchant',
         cancellation_refund_mode = v_refund_mode,
         updated_at = now()
   WHERE id = p_order_id;

  UPDATE public.order_payment_accounts SET expires_at = now()
   WHERE order_id = p_order_id
     AND (expires_at IS NULL OR expires_at > now());
  UPDATE public.order_wallet_funding_intents
     SET status = 'cancelled', updated_at = now()
   WHERE order_id = p_order_id
     AND status NOT IN ('completed', 'cancelled', 'expired', 'failed');

  SELECT COALESCE(sum(reversed_amount), 0)
    INTO v_wallet_reversed
    FROM public.reverse_wallet_redemption(
      p_order_id, COALESCE(v_reason, 'Order cancelled'), v_order.merchant_id
    );
  v_savings_reversed := public.reverse_savings_redemption_for_order(
    p_order_id, v_order.merchant_id, v_actor,
    COALESCE(v_reason, 'Order cancelled')
  );

  PERFORM private.restock_order_items(p_order_id);
  PERFORM private.release_order_inventory_units(
    v_order.merchant_id, p_order_id, 'available'
  );

  INSERT INTO public.order_audit_events (
    merchant_id, order_id, actor_user_id, action, change_category,
    changed_fields, before_snapshot, after_snapshot, metadata
  ) VALUES (
    v_order.merchant_id, p_order_id, v_actor, 'order.update',
    'customer_visible',
    ARRAY[
      'shipping_status', 'cancelled_at', 'cancellation_reason', 'cancelled_by',
      'cancellation_refund_mode'
    ],
    jsonb_build_object(
      'shipping_status', v_order.shipping_status,
      'cancelled_at', v_order.cancelled_at,
      'cancellation_reason', v_order.cancellation_reason,
      'cancelled_by', v_order.cancelled_by,
      'cancellation_refund_mode', v_order.cancellation_refund_mode
    ),
    jsonb_build_object(
      'shipping_status', 'cancelled', 'cancelled_at', now(),
      'cancellation_reason', v_reason, 'cancelled_by', 'merchant',
      'cancellation_refund_mode', v_refund_mode
    ),
    jsonb_build_object(
      'operation', 'merchant_order_cancellation',
      'wallet_reversed', v_wallet_reversed,
      'savings_reversed', v_savings_reversed,
      'refund_mode', v_refund_mode
    )
  );

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts
  ) VALUES (
    p_order_id, v_order.merchant_id, 'customer_email', 'failed',
    extensions.gen_random_uuid(), 0
  ) ON CONFLICT (order_id, step) DO NOTHING;

  -- 'manual' leaves the order without a refund step on purpose: the
  -- merchant refunds outside Baci and records it from the Refund card.
  -- The exception is a leg whose provider refund is already pending or
  -- terminal (e.g. PayPal flips the payment row itself), or has its own
  -- refund rows (the usual Paystack shape: the payment stays completed,
  -- whether the refund is in flight or already verified): those still need the row so the drain waits for the
  -- provider and runs aggregate finalization, while the worker never
  -- initiates a refund in manual mode (the persisted mode suppresses
  -- initiation).
  IF EXISTS (
    SELECT 1 FROM public.transactions t
     WHERE t.order_id = p_order_id
       AND t.merchant_id = v_order.merchant_id
       AND t.transaction_type = 'payment'
       -- Mirror the claim gate's funded-leg statuses: refund-state legs
       -- (e.g. PayPal flips the payment row itself while its provider
       -- refund is pending or terminal) need the row so the drain
       -- resumes them and runs aggregate finalization.
       AND t.status IN ('completed', 'refund_pending', 'refunded')
       AND (
         v_refund_mode = 'automatic'
         OR t.status IN ('refund_pending', 'refunded')
       )
       AND t.amount > 0
       AND COALESCE(public.normalized_gateway_name_v1(t.gateway), '') NOT IN (
         'WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY'
       )
  ) OR (
    v_refund_mode = 'manual' AND EXISTS (
      -- ANY refund evidence on the order, terminal included: a payment can
      -- stay 'completed' while its own refund rows (in flight, or already
      -- fully verified) exist, and only the refund step lets the drain wait
      -- for the provider and run aggregate finalization. The persisted
      -- manual mode still blocks every new initiation, so seeding only
      -- enables verification and finalization. The one exclusion mirrors the
      -- worker (collectAwaitingCancellationRefundLegs): a definitive
      -- provider rejection (explicit failed stamp) with no provider
      -- identity can never recover.
      SELECT 1 FROM public.transactions r
       WHERE r.order_id = p_order_id
         AND r.merchant_id = v_order.merchant_id
         AND r.transaction_type = 'refund'
         AND NOT (
           r.status = 'failed'
           -- NULL-safe: only an EXPLICIT provider 'failed' stamp is a
           -- definitive rejection; a missing verdict must still seed the step.
           AND COALESCE(r.metadata->>'provider_refund_status', '') = 'failed'
           AND COALESCE(r.gateway_reference, '') !~ '^[1-9][0-9]*$'
           AND COALESCE(r.metadata->>'provider_refund_id', '') !~ '^[1-9][0-9]*$'
         )
    )
  ) THEN
    INSERT INTO public.order_cancellation_side_effects (
      order_id, merchant_id, step, status, claim_token, attempts
    ) VALUES (
      p_order_id, v_order.merchant_id, 'refund', 'failed',
      extensions.gen_random_uuid(), 0
    ) ON CONFLICT (order_id, step) DO NOTHING;
  END IF;

  RETURN true;
END;
$$;

CREATE FUNCTION private.reverse_paid_order_amendment(a private.paid_order_amendments,p_reason text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  confirmed jsonb;
  document jsonb;
  old_line public.order_items%ROWTYPE;
  v_original_total numeric;
  branch uuid;
  fulfillment jsonb;
  before_revision jsonb;
BEGIN
  SELECT details INTO STRICT confirmed FROM private.paid_order_amendment_events WHERE amendment_id = a.id AND event_type = 'confirmed';
  SELECT original_document_inputs INTO STRICT document FROM private.paid_order_amendment_revisions
  WHERE amendment_id = a.id AND revision = 1;
  SELECT (jsonb_populate_record(NULL::public.order_items, item)).* INTO STRICT old_line
  FROM jsonb_array_elements(document->'items') item WHERE item->>'id' = confirmed#>>'{beforeLine,id}';
  v_original_total := (document#>>'{order,total}')::numeric;
  SELECT branch_id INTO branch FROM public.orders WHERE id = a.order_id;
  PERFORM 1 FROM public.products WHERE merchant_id = a.merchant_id
    AND id IN (old_line.product_id,(confirmed#>>'{afterLine,productId}')::uuid) ORDER BY id FOR UPDATE;
  before_revision := private.paid_order_document_inputs(a.order_id);
  UPDATE private.paid_order_amendments SET state = 'reversed',hold_fulfillment = false,
    refund_owed_minor = 0,balance_due_minor = 0 WHERE id = a.id;
  fulfillment := private.swap_paid_order_amendment_inventory(a.order_id,a.merchant_id,branch,
    confirmed || jsonb_build_object('beforeLine',confirmed->'afterLine','afterLine',confirmed->'beforeLine'));
  UPDATE public.order_items SET product_id = old_line.product_id, variant_id = old_line.variant_id,
    product_offer_id = old_line.product_offer_id, name = old_line.name, condition = old_line.condition,
    price = old_line.price, variant_name = old_line.variant_name, item_description = old_line.item_description,
    sellers_item_id = old_line.sellers_item_id, line_extension_amount = old_line.line_extension_amount,
    fulfillment_data = fulfillment WHERE id = old_line.id AND order_id = a.order_id;
  IF confirmed->>'pool' = 'serialized_variant' THEN
    PERFORM private.record_variant_inventory_event(vi.id,a.merchant_id,old_line.product_id,vi.variant_id,
      'hold_confirmed','available','reserved',a.order_id,old_line.id,vi.branch_id,auth.uid())
    FROM public.variant_inventory vi WHERE vi.order_id = a.order_id AND vi.order_item_id = old_line.id ORDER BY vi.id;
  END IF;
  UPDATE public.orders SET total = v_original_total, subtotal = v_original_total, tax_exclusive_amount = v_original_total,
    tax_inclusive_amount = v_original_total, payment_status = 'paid',
    fulfillment_details = CASE WHEN (SELECT count(*) FROM public.order_items WHERE order_id = a.order_id) = 1
      THEN fulfillment ELSE NULL END
  WHERE id = a.order_id;
  IF (SELECT o.total FROM public.orders o WHERE o.id = a.order_id) IS DISTINCT FROM v_original_total THEN
    RAISE EXCEPTION 'preview_stale';
  END IF;
  INSERT INTO private.paid_order_amendment_revisions(amendment_id,revision,original_document_inputs,revised_order_inputs)
  VALUES (a.id,2,before_revision,private.paid_order_document_inputs(a.order_id));
  INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
  VALUES (a.id,auth.uid(),'reversed',jsonb_build_object('reason',p_reason));
END;
$$;
REVOKE ALL ON FUNCTION private.reverse_paid_order_amendment(private.paid_order_amendments,text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.run_paid_order_amendment_action(p_order_id uuid,p_amendment_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  prior private.paid_order_amendment_operations%ROWTYPE;
  action text := p_payload->>'action';
  key text := p_payload->>'idempotencyKey';
  reason text := btrim(p_payload->>'reason');
  result jsonb;
  fields text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR key IS NULL OR key <> btrim(key)
    OR length(key) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'invalid_amendment_action' USING ERRCODE = '22023';
  END IF;
  fields := CASE action
    WHEN 'record_top_up' THEN ARRAY['evidenceId']
    WHEN 'claim_offline_disbursement' THEN ARRAY['sourceKind','sourceId']
    WHEN 'record_offline_refund' THEN ARRAY['claimId','evidenceId']
    WHEN 'retry_merchant_adjustment' THEN ARRAY['operationId']
    WHEN 'refresh_refund_status' THEN ARRAY['operationId']
    WHEN 'retry_failed_refund' THEN ARRAY['operationId']
    WHEN 'reverse' THEN ARRAY['reason']
    WHEN 'cancel_for_recovery' THEN ARRAY['reason']
  END;
  IF fields IS NULL OR NOT (p_payload ?& fields) OR
    (p_payload - (fields || ARRAY['action','idempotencyKey'])) <> '{}'::jsonb
    OR EXISTS (SELECT 1 FROM jsonb_each(p_payload) f WHERE jsonb_typeof(f.value) <> 'string') THEN
    RAISE EXCEPTION 'invalid_amendment_action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = p_amendment_id AND order_id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'amendment_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT private.can_access_paid_order_amendment(a.merchant_id,'edit') THEN
    RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id,0));
  PERFORM 1 FROM public.orders WHERE id = p_order_id AND merchant_id = a.merchant_id FOR UPDATE;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = p_amendment_id;
  IF NOT private.can_access_paid_order_amendment(a.merchant_id,'edit')
    OR (action IN ('claim_offline_disbursement','record_offline_refund','retry_merchant_adjustment',
          'refresh_refund_status','retry_failed_refund','reverse','cancel_for_recovery')
      AND NOT private.can_access_paid_order_amendment(a.merchant_id,'refund')) THEN
    RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO prior FROM private.paid_order_amendment_operations
    WHERE amendment_id = a.id AND idempotency_key = key;
  IF FOUND THEN
    IF prior.request IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    RETURN prior.result;
  END IF;
  CASE action
    WHEN 'record_top_up' THEN result := private.apply_paid_order_top_up(a,(p_payload->>'evidenceId')::uuid);
    WHEN 'claim_offline_disbursement','record_offline_refund' THEN result := private.apply_paid_order_disbursement(a,p_payload);
    WHEN 'refresh_refund_status','retry_failed_refund','retry_merchant_adjustment' THEN
      result := private.apply_paid_order_refund_operator_action(a,p_payload);
    WHEN 'reverse','cancel_for_recovery' THEN
      IF reason IS NULL OR length(reason) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'invalid_amendment_action' USING ERRCODE = '22023';
      END IF;
      IF a.state NOT IN ('awaiting_payment','awaiting_refund') THEN RAISE EXCEPTION 'amendment_ineligible'; END IF;
      IF EXISTS (SELECT 1 FROM private.paid_order_amendment_refunds
        WHERE amendment_id = a.id AND state NOT IN ('queued','failed','void'))
        OR EXISTS (SELECT 1 FROM private.paid_order_bank_evidence WHERE
          (order_id = a.order_id AND allocation = 'unapplied') OR (bound_order_id = a.order_id AND allocation IS NULL))
        OR EXISTS (SELECT 1 FROM private.paid_order_offline_disbursements WHERE order_id = a.order_id AND evidence_id IS NULL)
        OR EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions WHERE order_id = a.order_id AND returned_at IS NULL) THEN
        RAISE EXCEPTION 'amendment_payment_open';
      END IF;
      UPDATE private.paid_order_amendment_refunds SET state = 'void' WHERE amendment_id = a.id AND state = 'queued';
      IF action = 'reverse' THEN
        PERFORM private.reverse_paid_order_amendment(a,reason);
      ELSE
        UPDATE private.paid_order_amendments SET state = 'cancelled_for_recovery',hold_fulfillment = false,
          refund_owed_minor = 0,balance_due_minor = 0 WHERE id = a.id;
        IF NOT public.cancel_order_as_merchant(a.order_id,reason,'automatic') THEN
          RAISE EXCEPTION 'amendment_ineligible';
        END IF;
        INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
        VALUES (a.id,auth.uid(),'cancelled_for_recovery',jsonb_build_object('reason',reason));
      END IF;
      result := private.paid_order_amendment_summary(a.order_id);
  END CASE;
  INSERT INTO private.paid_order_amendment_operations(amendment_id,idempotency_key,request,result)
  VALUES (a.id,key,p_payload,result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.run_paid_order_amendment_action(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_paid_order_amendment_action(uuid,uuid,jsonb) TO authenticated;

CREATE FUNCTION private.guard_paid_order_amendment_refund_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.transaction_type <> 'refund' OR NEW.order_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.orders WHERE id = NEW.order_id FOR UPDATE;
  IF (NEW.metadata ? 'paid_order_amendment_refund_id'
      OR EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = NEW.order_id AND hold_fulfillment))
    AND NOT EXISTS (
      SELECT 1 FROM private.paid_order_amendment_refunds r
      JOIN private.paid_order_amendments a ON a.id = r.amendment_id
      WHERE a.order_id = NEW.order_id AND a.merchant_id = NEW.merchant_id
        AND r.id::text = NEW.metadata->>'paid_order_amendment_refund_id'
        AND r.payment_id::text = NEW.metadata->>'payment_transaction_id'
        AND r.state = 'processed' AND r.refund_transaction_id IS NULL
        AND NEW.gateway = 'paystack' AND NEW.status = 'completed' AND NEW.currency = 'NGN'
        AND NEW.amount * 100 = r.amount_minor AND NEW.gateway_reference = r.provider_refund_id
    ) THEN RAISE EXCEPTION 'amendment_hold'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_paid_order_amendment_refund_write()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER paid_order_amendment_refund_write
BEFORE INSERT ON public.transactions FOR EACH ROW WHEN (NEW.transaction_type = 'refund')
EXECUTE FUNCTION private.guard_paid_order_amendment_refund_write();

CREATE FUNCTION private.protect_paid_order_amendment_refund_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.paid_order_amendment_refunds WHERE refund_transaction_id = OLD.id) THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'amendment_refund_owned'; END IF;
    IF ROW(NEW.order_id,NEW.merchant_id,NEW.transaction_type,NEW.status,NEW.amount,NEW.currency,NEW.gateway,
        NEW.gateway_reference,NEW.metadata) IS DISTINCT FROM
       ROW(OLD.order_id,OLD.merchant_id,OLD.transaction_type,OLD.status,OLD.amount,OLD.currency,OLD.gateway,
        OLD.gateway_reference,OLD.metadata) THEN
      RAISE EXCEPTION 'amendment_refund_owned';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.metadata->>'paid_order_amendment_refund_id' IS DISTINCT FROM OLD.metadata->>'paid_order_amendment_refund_id' THEN
    RAISE EXCEPTION 'amendment_refund_owned';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_paid_order_amendment_refund_evidence()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER paid_order_amendment_refund_evidence_immutable
BEFORE UPDATE OF order_id,merchant_id,transaction_type,status,amount,currency,gateway,gateway_reference,metadata OR DELETE
ON public.transactions FOR EACH ROW WHEN (OLD.transaction_type = 'refund')
EXECUTE FUNCTION private.protect_paid_order_amendment_refund_evidence();
