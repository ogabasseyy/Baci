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

-- Finance can return an extra bank transfer without recording it as an order
-- payment or relaxing the hold on the original payment's refund.
CREATE FUNCTION private.apply_paid_order_verified_bank_return(
  a private.paid_order_amendments, p_payload jsonb
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF a.state <> 'settled' OR NOT a.hold_fulfillment OR NOT EXISTS (
    SELECT 1 FROM private.paid_order_amendment_events
    WHERE amendment_id = a.id AND event_type = 'verified_cancellation_opened'
  ) THEN RAISE EXCEPTION 'verified_funding_refund_review_required'; END IF;

  IF p_payload->>'action' = 'claim_offline_disbursement' THEN
    IF p_payload->>'sourceKind' IS DISTINCT FROM 'unapplied' THEN
      RAISE EXCEPTION 'bank_evidence_conflict';
    END IF;
    UPDATE private.paid_order_bank_evidence
    SET order_id = a.order_id, allocation = 'unapplied'
    WHERE id = (p_payload->>'sourceId')::uuid
      AND merchant_id = a.merchant_id AND direction = 'incoming'
      AND collection_method = 'bank_transfer' AND transaction_id IS NULL
      AND ((bound_order_id = a.order_id AND allocation IS NULL)
        OR (order_id = a.order_id AND allocation = 'unapplied'));
    IF NOT FOUND THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM private.paid_order_offline_disbursements claim
      JOIN private.paid_order_bank_evidence entry ON entry.id = claim.source_id
      WHERE claim.id = (p_payload->>'claimId')::uuid AND claim.order_id = a.order_id
        AND claim.source_kind = 'unapplied' AND entry.order_id = a.order_id
        AND entry.merchant_id = a.merchant_id AND entry.collection_method = 'bank_transfer'
        AND entry.direction = 'incoming' AND entry.allocation = 'unapplied'
    ) THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
  END IF;

  RETURN private.apply_paid_order_disbursement(a,p_payload);
END;
$$;
REVOKE ALL ON FUNCTION private.apply_paid_order_verified_bank_return(private.paid_order_amendments,jsonb)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.run_paid_order_amendment_action(p_order_id uuid,p_amendment_id uuid,p_payload jsonb)
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
    WHEN 'record_verified_lender_refund' THEN ARRAY[]::text[]
    WHEN 'open_verified_cancellation' THEN ARRAY['reason']
    WHEN 'cancel_with_verified_refunds' THEN ARRAY['reason']
    WHEN 'reverse' THEN ARRAY['reason']
    WHEN 'cancel_for_recovery' THEN ARRAY['reason']
  END;
  IF fields IS NULL OR NOT (p_payload ?& fields) OR
    (p_payload - (fields || ARRAY['action','idempotencyKey'])) <> '{}'::jsonb
    OR EXISTS (SELECT 1 FROM jsonb_each(p_payload) f WHERE jsonb_typeof(f.value) <> 'string') THEN
    RAISE EXCEPTION 'invalid_amendment_action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = p_amendment_id AND order_id = p_order_id;
  IF NOT FOUND OR NOT private.can_access_paid_order_amendment(a.merchant_id,'edit') THEN
    RAISE EXCEPTION 'amendment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF action = 'open_verified_cancellation' THEN
    PERFORM 1 FROM private.paid_order_amendment_config WHERE merchant_id = a.merchant_id FOR SHARE;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id,0));
  PERFORM 1 FROM public.orders WHERE id = p_order_id AND merchant_id = a.merchant_id FOR UPDATE;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = p_amendment_id;
  IF NOT private.can_access_paid_order_amendment(a.merchant_id,'edit')
    OR (action IN ('claim_offline_disbursement','record_offline_refund','retry_merchant_adjustment',
          'refresh_refund_status','retry_failed_refund','reverse','cancel_for_recovery','record_verified_lender_refund',
          'open_verified_cancellation','cancel_with_verified_refunds')
      AND NOT private.can_access_paid_order_amendment(a.merchant_id,'refund')) THEN
    RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO prior FROM private.paid_order_amendment_operations
    WHERE amendment_id = a.id AND idempotency_key = key;
  IF FOUND THEN
    IF prior.request IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    RETURN prior.result;
  END IF;
  IF a.settlement_route = 'verified_funds' AND action NOT IN
    ('record_verified_lender_refund','open_verified_cancellation','cancel_with_verified_refunds',
      'claim_offline_disbursement','record_offline_refund')
  THEN RAISE EXCEPTION 'verified_funding_refund_review_required'; END IF;
  IF a.settlement_route <> 'verified_funds' AND action IN
    ('record_verified_lender_refund','open_verified_cancellation','cancel_with_verified_refunds')
  THEN RAISE EXCEPTION 'amendment_ineligible'; END IF;
  CASE action
    WHEN 'open_verified_cancellation' THEN result := private.open_paid_order_verified_cancellation(a,reason);
    WHEN 'record_verified_lender_refund' THEN result := private.apply_paid_order_verified_refund(a,'downgrade',NULL);
    WHEN 'cancel_with_verified_refunds' THEN result := private.apply_paid_order_verified_refund(a,'cancellation',reason);
    WHEN 'record_top_up' THEN result := private.apply_paid_order_top_up(a,(p_payload->>'evidenceId')::uuid);
    WHEN 'claim_offline_disbursement','record_offline_refund' THEN
      IF a.settlement_route = 'verified_funds' THEN
        result := private.apply_paid_order_verified_bank_return(a,p_payload);
      ELSE
        result := private.apply_paid_order_disbursement(a,p_payload);
      END IF;
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
