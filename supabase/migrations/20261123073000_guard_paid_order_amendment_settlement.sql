-- Align staff tender and verified cancellation controls with pending payment evidence.

CREATE OR REPLACE FUNCTION private.add_paid_order_amendment_quote_options(p_quote jsonb,p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF (p_quote->>'adjustmentMinor')::bigint <> 0 AND EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = (p_quote->>'captureId')::uuid AND t.order_id = p_order_id
      AND t.gateway_response ? 'baci_paystack_checkout_customer_fee_minor'
  ) THEN RAISE EXCEPTION 'scenario_disabled'; END IF;
  IF p_quote ? 'funding' AND (p_quote->>'adjustmentMinor')::bigint > 0
    AND p_quote->'bankEvidence' = '[]'::jsonb AND EXISTS (
      SELECT 1 FROM private.paid_order_amendment_config c
      JOIN public.orders o ON o.merchant_id = c.merchant_id
      WHERE o.id = p_order_id AND c.enabled AND c.staff_tender_enabled
        AND c.bank_account_id IS NOT NULL
        AND c.bank_evidence_cutover <= statement_timestamp()
        AND NOT EXISTS (
          SELECT 1 FROM private.paid_order_bank_evidence e
          WHERE e.merchant_id = o.merchant_id AND e.direction = 'incoming'
            AND ((e.bound_order_id = o.id AND e.allocation IS NULL)
              OR (e.order_id = o.id AND e.allocation = 'unapplied'))
        )
    ) THEN
    p_quote := p_quote || '{"canRecordStaffTopUp":true}'::jsonb;
  END IF;
  RETURN (SELECT p_quote || jsonb_build_object(
    'beforeLine',(p_quote->'beforeLine') || jsonb_build_object('variantName',i.variant_name),
    'afterLine',(p_quote->'afterLine') || jsonb_build_object('variantName',(
      SELECT string_agg(value,' / ' ORDER BY key)
      FROM jsonb_each_text(CASE WHEN jsonb_typeof(v.attributes) = 'object'
        THEN v.attributes ELSE '{}'::jsonb END)
      WHERE NULLIF(btrim(value),'') IS NOT NULL
    ))
  )
  FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
  LEFT JOIN public.product_variants v ON v.id = (p_quote#>>'{afterLine,variantId}')::uuid
    AND v.merchant_id = o.merchant_id AND v.product_id = (p_quote#>>'{afterLine,productId}')::uuid
  WHERE i.order_id = p_order_id AND i.id = (p_quote#>>'{beforeLine,id}')::uuid);
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_verified_funding_amendment_transactions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  prior_order uuid;
  next_order uuid;
BEGIN
  -- A timestamp-only refresh cannot change the pinned funding digest. Its
  -- row lock is already held, so avoid acquiring the order lock in reverse.
  IF TG_OP = 'UPDATE' AND
    (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN prior_order := OLD.order_id; END IF;
  IF TG_OP <> 'DELETE' THEN next_order := NEW.order_id; END IF;
  -- Serialize ledger changes for approved orders with preview confirmation, even
  -- when a provider writer has not adopted the payment advisory lock.
  PERFORM 1 FROM public.orders o JOIN private.paid_order_verified_funding f ON f.order_id = o.id
  WHERE o.id IN (prior_order,next_order) ORDER BY o.id FOR UPDATE OF o;
  IF NOT EXISTS (SELECT 1 FROM private.paid_order_amendments
    WHERE order_id IN (prior_order,next_order) AND settlement_route = 'verified_funds') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  -- The existing evidence allocator pins the top-up transaction before insertion.
  -- No other transaction mutation can silently change the verified funding set.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM private.paid_order_bank_evidence e
    WHERE e.order_id = NEW.order_id AND e.transaction_id = NEW.id AND e.allocation = 'top_up'
  ) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.transaction_type = 'refund' AND EXISTS (
    SELECT 1 FROM private.paid_order_verified_refund_evidence r
    JOIN public.transactions p ON p.id = r.payment_id AND p.order_id = r.order_id
    WHERE r.order_id = NEW.order_id AND r.transaction_id = NEW.id AND p.merchant_id = NEW.merchant_id
      AND p.gateway = NEW.gateway AND NEW.gateway_reference = 'verified-refund:' || r.id
      AND r.id::text = NEW.metadata->>'verified_refund_evidence_id'
      AND r.payment_id::text = NEW.metadata->>'payment_transaction_id'
      AND r.method = NEW.metadata->>'method' AND r.amount_minor = NEW.amount * 100
      AND NEW.currency = 'NGN' AND NEW.status = 'completed'
  ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'verified_funding_refund_review_required';
END;
$$;

CREATE OR REPLACE FUNCTION public.read_paid_order_amendment_workspace(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  result jsonb;
  edit_allowed boolean;
  refund_allowed boolean;
  a private.paid_order_amendments%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  result := public.read_paid_order_amendment(p_order_id);
  edit_allowed := private.can_access_paid_order_amendment(o.merchant_id,'edit');
  refund_allowed := edit_allowed AND private.can_access_paid_order_amendment(o.merchant_id,'refund');
  SELECT * INTO a FROM private.paid_order_amendments WHERE order_id = o.id;
  RETURN result || jsonb_build_object(
    'canStart',edit_allowed AND a.id IS NULL AND (
      o.source = 'online_store'
      OR EXISTS (SELECT 1 FROM private.paid_order_verified_funding WHERE order_id = o.id)
    )
      AND o.payment_status = 'paid' AND o.shipping_status IN ('pending','processing')
      AND o.cancelled_at IS NULL AND o.shipment_id IS NULL AND o.shipment_booking_lock_token IS NULL
      AND EXISTS (SELECT 1 FROM private.paid_order_amendment_config
        WHERE merchant_id = o.merchant_id AND enabled AND cardinality(scenarios) > 0),
    'canEdit',edit_allowed,'canRefund',refund_allowed,
    'isVerifiedFunding', COALESCE(a.settlement_route = 'verified_funds',false),
    'verifiedCreditDirectRefund', refund_allowed AND a.settlement_route = 'verified_funds'
      AND a.state = 'awaiting_refund' AND private.verified_credit_direct_capture(o.id) IS NOT NULL
      AND EXISTS (SELECT 1 FROM private.paid_order_verified_refund_evidence
        WHERE order_id = o.id AND purpose = 'downgrade' AND transaction_id IS NULL),
    'canOpenVerifiedCancellation', refund_allowed AND a.settlement_route = 'verified_funds'
      AND a.state = 'settled' AND NOT a.hold_fulfillment AND o.cancelled_at IS NULL
      AND o.shipping_status IN ('pending','processing') AND o.shipment_id IS NULL
      AND o.tracking_number IS NULL AND o.shipment_booking_lock_token IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.order_id = o.id
        AND t.status IN ('pending','processing','refund_pending'))
      AND NOT EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions
        WHERE order_id = o.id AND returned_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM private.paid_order_bank_evidence e
        WHERE (e.order_id = o.id AND e.allocation = 'unapplied')
          OR (e.bound_order_id = o.id AND e.allocation IS NULL))
      AND private.verified_credit_direct_capture(o.id) IS NOT NULL
      AND EXISTS (SELECT 1 FROM private.paid_order_amendment_config WHERE merchant_id = o.merchant_id
        AND enabled AND verified_credit_direct_refunds_enabled),
    'verifiedCancellationPending', refund_allowed AND a.settlement_route = 'verified_funds'
      AND a.state = 'settled' AND a.hold_fulfillment AND EXISTS (
        SELECT 1 FROM private.paid_order_amendment_events WHERE amendment_id = a.id AND event_type = 'verified_cancellation_opened'),
    'verifiedCancellationReady', refund_allowed AND a.settlement_route = 'verified_funds'
      AND a.state = 'settled' AND a.hold_fulfillment
      AND o.cancelled_at IS NULL AND o.shipping_status IN ('pending','processing')
      AND o.shipment_id IS NULL AND o.tracking_number IS NULL AND o.shipment_booking_lock_token IS NULL
      AND NOT EXISTS (SELECT 1 FROM private.paid_order_bank_evidence e
        WHERE (e.order_id = o.id AND e.allocation = 'unapplied')
          OR (e.bound_order_id = o.id AND e.allocation IS NULL))
      AND NOT EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions
        WHERE order_id = o.id AND returned_at IS NULL)
      AND (o.total * 100)::bigint = (
        SELECT COALESCE(sum(amount_minor),0) FROM private.paid_order_verified_refund_evidence
        WHERE order_id = o.id AND purpose = 'cancellation' AND transaction_id IS NULL),
    'confirmationKey',CASE WHEN edit_allowed AND a.actor_id = auth.uid() THEN a.idempotency_key END,
    'customer',private.paid_order_amendment_customer_status(o.id),
    'refunds',CASE WHEN refund_allowed THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'amountMinor',r.amount_minor,
        'preflightReview',r.preflight_review)
        ORDER BY r.created_at DESC,r.id DESC)
      FROM private.paid_order_amendment_refunds r WHERE r.amendment_id = a.id
    ),'[]'::jsonb) ELSE '[]'::jsonb END,
    'bankEvidence',CASE WHEN edit_allowed AND a.id IS NOT NULL THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',q.id,'amountMinor',q.amount_minor,'status',q.allocation,
        'transactionId',q.transaction_id,'occurredAt',q.occurred_at,'method',q.collection_method))
      FROM (SELECT e.* FROM private.paid_order_bank_evidence e
        WHERE e.merchant_id = o.merchant_id AND e.direction = 'incoming' AND (
          (e.order_id = o.id AND e.allocation IN ('unapplied','top_up'))
          OR (e.allocation IS NULL AND e.bound_order_id = o.id)
        ) ORDER BY e.occurred_at DESC,e.id LIMIT 30) q
    ),'[]'::jsonb) ELSE '[]'::jsonb END
  );
END;
$$;
