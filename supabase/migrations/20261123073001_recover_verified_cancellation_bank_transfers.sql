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
