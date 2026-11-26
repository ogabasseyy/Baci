-- Keep an open return claim tied to the account on which its transfer was received.
CREATE FUNCTION private.guard_paid_order_bank_return_claim_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  source private.paid_order_bank_evidence%ROWTYPE;
  active_account uuid;
BEGIN
  SELECT * INTO source FROM private.paid_order_bank_evidence WHERE id = NEW.source_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
  SELECT bank_account_id INTO active_account FROM private.paid_order_amendment_config
  WHERE merchant_id = source.merchant_id FOR SHARE;
  IF NOT FOUND OR active_account IS DISTINCT FROM source.account_id THEN
    RAISE EXCEPTION 'bank_evidence_conflict';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER paid_order_bank_return_claim_account_guard
BEFORE INSERT ON private.paid_order_offline_disbursements
FOR EACH ROW EXECUTE FUNCTION private.guard_paid_order_bank_return_claim_account();

CREATE FUNCTION private.prevent_bank_account_rotation_with_open_return_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.bank_account_id IS DISTINCT FROM NEW.bank_account_id AND EXISTS (
    SELECT 1 FROM private.paid_order_offline_disbursements claim
    WHERE claim.account_id = OLD.bank_account_id AND claim.evidence_id IS NULL
  ) THEN
    RAISE EXCEPTION 'bank_return_claim_open';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER paid_order_bank_account_rotation_guard
BEFORE UPDATE OF bank_account_id ON private.paid_order_amendment_config
FOR EACH ROW EXECUTE FUNCTION private.prevent_bank_account_rotation_with_open_return_claim();

CREATE OR REPLACE FUNCTION public.register_paid_order_tender_receipt(
  p_order_id uuid,p_method text,p_receipt_reference text,p_reconciliation_reference text,
  p_amount_minor bigint,p_occurred_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  c private.paid_order_amendment_config%ROWTYPE;
  e private.paid_order_bank_evidence%ROWTYPE;
  receipt_key text := 'tender:' || p_method || ':' || upper(p_receipt_reference);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'bank_evidence_worker_required' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_method,'') NOT IN ('cash','pos')
    OR COALESCE(p_receipt_reference,'') !~ '^[A-Za-z0-9_.:/-]{8,100}$'
    OR length(COALESCE(p_reconciliation_reference,'')) NOT BETWEEN 8 AND 160
    OR p_occurred_at IS NULL OR p_occurred_at > clock_timestamp()
    OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 9999999999 THEN
    RAISE EXCEPTION 'tender_evidence_required';
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  SELECT * INTO c FROM private.paid_order_amendment_config WHERE merchant_id = o.merchant_id FOR SHARE;
  IF NOT FOUND OR c.bank_account_id IS NULL OR p_occurred_at < c.bank_evidence_cutover THEN
    RAISE EXCEPTION 'tender_evidence_required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id::text,0));
  SELECT * INTO STRICT o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  SELECT * INTO e FROM private.paid_order_bank_evidence
  WHERE account_id = c.bank_account_id AND bank_transaction_id = receipt_key;
  IF FOUND THEN
    IF ROW(e.bound_order_id,e.collection_method,e.amount_minor,e.occurred_at,e.statement_entry)
      IS DISTINCT FROM ROW(o.id,p_method,p_amount_minor,p_occurred_at,p_reconciliation_reference) THEN
      RAISE EXCEPTION 'bank_evidence_conflict';
    END IF;
    RETURN e.id;
  END IF;
  IF p_receipt_reference !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,99}$' THEN
    RAISE EXCEPTION 'tender_evidence_required';
  END IF;
  IF NOT c.enabled OR NOT c.verified_cash_pos_enabled OR o.payment_status <> 'paid'
    OR o.cancelled_at IS NOT NULL OR o.shipping_status NOT IN ('pending','processing')
    OR NOT EXISTS (SELECT 1 FROM private.paid_order_verified_funding WHERE order_id = o.id)
    OR EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = o.id) THEN
    RAISE EXCEPTION 'scenario_disabled';
  END IF;
  INSERT INTO private.paid_order_bank_evidence(merchant_id,account_id,bank_transaction_id,
    direction,amount_minor,currency,occurred_at,statement_entry,bound_order_id,collection_method)
  VALUES (o.merchant_id,c.bank_account_id,receipt_key,
    'incoming',p_amount_minor,'NGN',p_occurred_at,p_reconciliation_reference,o.id,p_method)
  RETURNING id INTO e.id;
  RETURN e.id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_paid_order_tender_receipt(uuid,text,text,text,bigint,timestamptz)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_paid_order_tender_receipt(uuid,text,text,text,bigint,timestamptz) TO service_role;

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
