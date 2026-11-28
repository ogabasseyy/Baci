-- Preserve the source account while an allocated top-up can still require a
-- cancellation return. Once canceled or fulfillment starts, no future claim can
-- depend on that active-account binding; an open claim still blocks rotation.
CREATE OR REPLACE FUNCTION private.prevent_bank_account_rotation_with_open_return_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.bank_account_id IS DISTINCT FROM NEW.bank_account_id AND (
    EXISTS (
      SELECT 1 FROM private.paid_order_offline_disbursements claim
      JOIN public.orders claim_order ON claim_order.id = claim.order_id
      WHERE claim_order.merchant_id = OLD.merchant_id
        AND claim.account_id = OLD.bank_account_id
        AND claim.evidence_id IS NULL
    ) OR EXISTS (
      SELECT 1 FROM private.paid_order_bank_evidence entry
      WHERE entry.merchant_id = OLD.merchant_id
        AND entry.account_id = OLD.bank_account_id
        AND entry.direction = 'incoming'
        AND ((entry.bound_order_id IS NOT NULL AND entry.allocation IS NULL
          AND EXISTS (SELECT 1 FROM public.orders o
            WHERE o.id = entry.bound_order_id AND o.merchant_id = entry.merchant_id
              AND o.payment_status = 'paid' AND o.cancelled_at IS NULL
              AND o.shipping_status IN ('pending','processing')
              AND o.shipment_id IS NULL AND o.tracking_number IS NULL
              AND o.shipment_booking_lock_token IS NULL
              AND NOT EXISTS (SELECT 1 FROM private.paid_order_amendments a WHERE a.order_id = o.id)))
          OR (entry.order_id IS NOT NULL AND entry.allocation = 'unapplied'
            AND EXISTS (
              SELECT 1 FROM public.orders o
              WHERE o.id = entry.order_id AND o.merchant_id = entry.merchant_id
                AND o.payment_status = 'paid' AND o.cancelled_at IS NULL
                AND o.shipping_status IN ('pending','processing')
                AND o.shipment_id IS NULL AND o.tracking_number IS NULL
                AND o.shipment_booking_lock_token IS NULL
            ))
          OR (entry.order_id IS NOT NULL AND entry.allocation = 'top_up'
            AND EXISTS (
              SELECT 1 FROM public.orders o
              WHERE o.id = entry.order_id AND o.cancelled_at IS NULL
                AND o.shipping_status IN ('pending','processing')
                AND o.shipment_id IS NULL AND o.tracking_number IS NULL
                AND o.shipment_booking_lock_token IS NULL
            )))
    )
  ) THEN
    RAISE EXCEPTION 'bank_return_claim_open';
  END IF;
  RETURN NEW;
END;
$$;


ALTER TABLE private.paid_order_verified_refund_evidence
  ADD COLUMN merchant_id uuid;

UPDATE private.paid_order_verified_refund_evidence evidence
SET merchant_id = orders.merchant_id
FROM public.orders orders
WHERE orders.id = evidence.order_id;

ALTER TABLE private.paid_order_verified_refund_evidence
  ALTER COLUMN merchant_id SET NOT NULL,
  ADD CONSTRAINT paid_order_verified_refund_evidence_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id),
  DROP CONSTRAINT paid_order_verified_refund_evidence_method_reference_key;

CREATE UNIQUE INDEX paid_order_verified_refund_evidence_merchant_method_reference_uidx
  ON private.paid_order_verified_refund_evidence (merchant_id, method, reference);

CREATE FUNCTION private.bind_paid_order_verified_refund_evidence_merchant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  expected_merchant_id uuid;
BEGIN
  SELECT orders.merchant_id INTO expected_merchant_id
  FROM public.orders orders WHERE orders.id = NEW.order_id;
  IF NOT FOUND OR (NEW.merchant_id IS NOT NULL AND NEW.merchant_id IS DISTINCT FROM expected_merchant_id) THEN
    RAISE EXCEPTION 'refund_evidence_required';
  END IF;
  NEW.merchant_id := expected_merchant_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.bind_paid_order_verified_refund_evidence_merchant()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER paid_order_verified_refund_evidence_merchant_guard
BEFORE INSERT OR UPDATE ON private.paid_order_verified_refund_evidence
FOR EACH ROW EXECUTE FUNCTION private.bind_paid_order_verified_refund_evidence_merchant();

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
      (NOT EXISTS (SELECT 1 FROM private.paid_order_verified_funding WHERE order_id = o.id)
        AND o.source = 'online_store')
      OR (EXISTS (SELECT 1 FROM private.paid_order_verified_funding WHERE order_id = o.id)
        AND private.verified_credit_direct_capture(o.id) IS NOT NULL)
    )
      AND o.payment_status = 'paid' AND o.shipping_status IN ('pending','processing')
      AND o.cancelled_at IS NULL AND o.shipment_id IS NULL AND o.tracking_number IS NULL
      AND o.shipment_booking_lock_token IS NULL
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
REVOKE ALL ON FUNCTION public.read_paid_order_amendment_workspace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_paid_order_amendment_workspace(uuid) TO authenticated, service_role;
