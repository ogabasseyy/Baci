CREATE OR REPLACE FUNCTION pg_temp.assert_verified_tender_cancellation(
  p_fixture jsonb, p_method text, p_order uuid, p_merchant uuid, p_lender uuid,
  p_capture_reference text, p_paid_leg uuid, p_paid_reference text, p_amendment uuid,
  p_receipt uuid, p_bank_account uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  f ALIAS FOR $1;
  method ALIAS FOR $2;
  o ALIAS FOR $3;
  m ALIAS FOR $4;
  lender ALIAS FOR $5;
  capture_reference ALIAS FOR $6;
  paid_leg ALIAS FOR $7;
  paid_reference ALIAS FOR $8;
  amendment ALIAS FOR $9;
  receipt ALIAS FOR $10;
  bank_account ALIAS FOR $11;
  late_transfer uuid;
  outgoing uuid;
  rotation_account uuid;
  rotation_cutover timestamptz;
  claim jsonb;
  return_payload jsonb;
  payload jsonb;
  result jsonb;
  refund_amount bigint;
  draft_cancel jsonb := '{"action":"open_verified_cancellation","reason":"Synthetic cancellation","idempotencyKey":"cancel-open-verified"}';
  confirm_cancel jsonb := '{"action":"cancel_with_verified_refunds","reason":"Synthetic cancellation","idempotencyKey":"cancel-confirm-verified"}';
BEGIN
    IF method = 'bank_transfer' THEN
      SELECT bank_account_id INTO STRICT bank_account
      FROM private.paid_order_amendment_config WHERE merchant_id = m;
      PERFORM set_config('request.jwt.claim.role','service_role',true);
      late_transfer := public.register_paid_order_bank_evidence(
        bank_account,'PRE-HOLD-TRANSFER-' || o,'incoming',500000,now(),
        'Pre-hold bank transfer fixture',NULL,o);
      PERFORM set_config('request.jwt.claim.role','authenticated',true);
    END IF;

    -- An ordinary cancellation cannot bypass the lender process.
    BEGIN
      PERFORM public.cancel_order_as_merchant(o,'Synthetic ordinary attempt','automatic');
      RAISE EXCEPTION 'Ordinary cancellation bypassed the hold';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> ALL (ARRAY['verified_funding_refund_review_required','paid_order_ledger_inconsistent']) THEN RAISE; END IF;
    END;
    UPDATE public.orders SET tracking_number = 'TRACKED-' || o WHERE id = o;
    IF public.read_paid_order_amendment_workspace(o)->>'canOpenVerifiedCancellation' IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'Cancellation offered after a tracking number was set';
    END IF;
    UPDATE public.orders SET tracking_number = NULL WHERE id = o;
    IF public.read_paid_order_amendment_workspace(o)->>'canOpenVerifiedCancellation' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Cancellation missing for an eligible order with a pending transfer';
    END IF;
    result := public.run_paid_order_amendment_action(o,amendment,draft_cancel);
    IF result->>'holdFulfillment' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Missing cancellation hold'; END IF;
    BEGIN
      UPDATE public.orders SET shipping_status = 'shipped' WHERE id = o;
      RAISE EXCEPTION 'Fulfillment could race lender cancellation';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'amendment_hold' THEN RAISE; END IF;
    END;
    UPDATE private.paid_order_amendment_config SET enabled = false,version = version + 1 WHERE merchant_id = m;
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    PERFORM set_config('request.jwt.claim.sub','',true);
    refund_amount := CASE WHEN method = 'downgrade' THEN 10986750 ELSE 12986750 END;
    PERFORM public.register_paid_order_verified_refund(o,lender,capture_reference,'cancellation',
      'LENDER-CANCEL-REF-12345','FINANCE-CANCELLATION-' || o,refund_amount);
    IF method <> 'downgrade' THEN
      PERFORM set_config('request.jwt.claim.role','authenticated',true);
      PERFORM set_config('request.jwt.claim.sub',f->>'actor',true);
      BEGIN
        PERFORM public.run_paid_order_amendment_action(o,amendment,confirm_cancel);
        RAISE EXCEPTION 'Cancellation proceeded before the top-up was returned';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'refund_evidence_required' THEN RAISE; END IF;
      END;
      PERFORM set_config('request.jwt.claim.role','service_role',true);
      PERFORM public.register_paid_order_verified_refund(o,paid_leg,paid_reference,'cancellation',
        'TENDER-RETURN-REF-12345','FINANCE-TENDER-RETURN-' || o,2000000);
    END IF;
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub',f->>'actor',true);
    IF public.read_paid_order_amendment_workspace(o)->>'verifiedCancellationReady'
      IS DISTINCT FROM (CASE WHEN method = 'bank_transfer' THEN 'false' ELSE 'true' END) THEN
      RAISE EXCEPTION 'Cancellation readiness did not match pending refund evidence';
    END IF;
    IF method = 'bank_transfer' THEN
      PERFORM set_config('request.jwt.claim.role','service_role',true);
      outgoing := public.register_paid_order_bank_evidence(
        bank_account,'LATE-RETURN-' || o,'outgoing',500000,now(),'Verified outgoing return fixture',late_transfer);
      PERFORM set_config('request.jwt.claim.role','authenticated',true);
      IF public.read_paid_order_amendment_workspace(o)->>'verifiedCancellationReady' IS DISTINCT FROM 'false' THEN
        RAISE EXCEPTION 'Cancellation offered with an unresolved incoming transfer';
      END IF;
      BEGIN
        PERFORM public.run_paid_order_amendment_action(o,amendment,confirm_cancel);
        RAISE EXCEPTION 'Cancellation finalized before late transfer was returned';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'refund_evidence_required' THEN RAISE; END IF;
      END;
      BEGIN
        UPDATE private.paid_order_amendment_config
        SET bank_account_id = gen_random_uuid(),bank_evidence_cutover = now()
        WHERE merchant_id = m;
        RAISE EXCEPTION 'Bank account rotated with an unclaimed cancellation return';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'bank_return_claim_open' THEN RAISE; END IF;
      END;
      IF (SELECT bank_account_id FROM private.paid_order_amendment_config WHERE merchant_id = m)
        IS DISTINCT FROM bank_account THEN
        RAISE EXCEPTION 'Rejected unclaimed-return rotation changed the configured account';
      END IF;
      payload := jsonb_build_object('action','claim_offline_disbursement',
        'sourceKind','unapplied','sourceId',late_transfer,'idempotencyKey','claim-late-bank-return');
      claim := public.run_paid_order_amendment_action(o,amendment,payload);
      IF claim->>'amountMinor' IS DISTINCT FROM '500000'
        OR public.run_paid_order_amendment_action(o,amendment,payload) IS DISTINCT FROM claim THEN
        RAISE EXCEPTION 'Late bank return claim did not replay exactly';
      END IF;
      BEGIN
        UPDATE private.paid_order_amendment_config
        SET bank_account_id = gen_random_uuid(),bank_evidence_cutover = now()
        WHERE merchant_id = m;
        RAISE EXCEPTION 'Bank account rotated with an open return claim';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'bank_return_claim_open' THEN RAISE; END IF;
      END;
      IF (SELECT bank_account_id FROM private.paid_order_amendment_config WHERE merchant_id = m)
        IS DISTINCT FROM bank_account THEN
        RAISE EXCEPTION 'Rejected bank account rotation changed the configured account';
      END IF;
      return_payload := jsonb_build_object('action','record_offline_refund',
        'claimId',claim->>'claimId','evidenceId',outgoing,'idempotencyKey','verify-late-bank-return');
      result := public.run_paid_order_amendment_action(o,amendment,return_payload);
      IF result->>'outcome' IS DISTINCT FROM 'verified'
        OR public.run_paid_order_amendment_action(o,amendment,return_payload) IS DISTINCT FROM result
        OR (SELECT count(*) FROM private.paid_order_bank_evidence WHERE id IN (late_transfer,outgoing)
          AND allocation = 'returned' AND transaction_id IS NULL) <> 2
        OR (SELECT count(*) FROM public.transactions WHERE order_id = o AND transaction_type = 'refund') <> 0
        OR public.read_paid_order_amendment_workspace(o)->>'verifiedCancellationReady' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Late transfer did not return exactly once outside the order ledger';
      END IF;
    END IF;
    result := public.run_paid_order_amendment_action(o,amendment,confirm_cancel);
    IF result->>'state' IS DISTINCT FROM 'cancelled_for_recovery'
      OR public.run_paid_order_amendment_action(o,amendment,confirm_cancel) IS DISTINCT FROM result
      OR (SELECT payment_status FROM public.orders WHERE id = o) IS DISTINCT FROM 'refunded'
      OR (SELECT count(*) FROM public.transactions WHERE order_id = o AND transaction_type = 'refund') <> 2
      OR (SELECT status FROM public.variant_inventory WHERE id = (f->>'newUnit')::uuid) IS DISTINCT FROM 'available'
      OR (public.read_paid_order_amendment_document(o,'current')#>>'{inputs,order,amount_paid}')::numeric
        IS DISTINCT FROM 0::numeric THEN
      RAISE EXCEPTION 'Verified cancellation refund, idempotency, restock or invoice drift: %',result;
    END IF;
    IF method IN ('cash','pos') THEN
      rotation_account := gen_random_uuid();
      rotation_cutover := now() + interval '1 second';
      UPDATE private.paid_order_amendment_config
      SET bank_account_id = rotation_account,bank_evidence_cutover = rotation_cutover
      WHERE merchant_id = m;
      IF (SELECT bank_account_id FROM private.paid_order_amendment_config WHERE merchant_id = m)
        IS DISTINCT FROM rotation_account THEN
        RAISE EXCEPTION 'Bank account rotation remained blocked after order cancellation';
      END IF;
      PERFORM set_config('request.jwt.claim.role','service_role',true);
      IF public.register_paid_order_tender_receipt(
        o,method,'FIXTURE-' || o,'AUDITED-REGISTER-' || o,2000000,now()) IS DISTINCT FROM receipt THEN
        RAISE EXCEPTION 'Exact tender receipt replay changed after account rotation';
      END IF;
      PERFORM set_config('request.jwt.claim.role','authenticated',true);
    END IF;
    IF method = 'bank_transfer' THEN
      rotation_account := gen_random_uuid();
      rotation_cutover := now() + interval '1 second';
      UPDATE private.paid_order_amendment_config
      SET bank_account_id = rotation_account,bank_evidence_cutover = rotation_cutover
      WHERE merchant_id = m;
      IF (SELECT bank_account_id FROM private.paid_order_amendment_config WHERE merchant_id = m)
          IS DISTINCT FROM rotation_account
        OR (SELECT bank_evidence_cutover FROM private.paid_order_amendment_config WHERE merchant_id = m)
          IS DISTINCT FROM rotation_cutover THEN
        RAISE EXCEPTION 'Bank account rotation remained blocked after return settlement';
      END IF;
    END IF;

END;
$$;
