-- Let Finance open the verified-cancellation hold before reconciling extra bank transfers.

CREATE OR REPLACE FUNCTION private.open_paid_order_verified_cancellation(a private.paid_order_amendments,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT o FROM public.orders WHERE id = a.order_id FOR UPDATE;
  IF length(COALESCE(p_reason,'')) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_amendment_action' USING ERRCODE = '22023';
  END IF;
  IF a.state <> 'settled' OR a.hold_fulfillment
    OR private.verified_credit_direct_capture(o.id) IS NULL
    OR NOT EXISTS (SELECT 1 FROM private.paid_order_amendment_config WHERE merchant_id = o.merchant_id
      AND enabled AND verified_credit_direct_refunds_enabled)
    OR (o.cancelled_at IS NOT NULL OR o.shipping_status NOT IN ('pending','processing')
      OR o.shipment_id IS NOT NULL OR o.tracking_number IS NOT NULL OR o.shipment_booking_lock_token IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.transactions t WHERE t.order_id = o.id
      AND t.status IN ('pending','processing','refund_pending'))
    OR EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions WHERE order_id = o.id AND returned_at IS NULL)
  THEN RAISE EXCEPTION 'verified_funding_refund_review_required'; END IF;
  UPDATE private.paid_order_amendments SET hold_fulfillment = true WHERE id = a.id;
  INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
  VALUES (a.id,auth.uid(),'verified_cancellation_opened',jsonb_build_object('reason',p_reason));
  RETURN private.paid_order_amendment_summary(a.order_id);
END;
$$;
REVOKE ALL ON FUNCTION private.open_paid_order_verified_cancellation(private.paid_order_amendments,text) FROM PUBLIC, anon, authenticated, service_role;

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
