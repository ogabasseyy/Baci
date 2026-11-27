\set ON_ERROR_STOP on
\ir fixtures/paid-order-amendments/verified-funding-setup.inc.sql
\ir fixtures/paid-order-amendments/verified-tender-cancellation.inc.sql

BEGIN;
DO $$
DECLARE
  f jsonb;
  method text;
  o uuid;
  m uuid;
  lender uuid;
  capture_reference text;
  paid_leg uuid;
  paid_reference text;
  receipt uuid;
  late_transfer uuid;
  outgoing uuid;
  bank_account uuid;
  rotation_account uuid;
  rotation_cutover timestamptz;
  claim jsonb;
  return_payload jsonb;
  amendment uuid;
  quote jsonb;
  payload jsonb;
  result jsonb;
  refund_amount bigint;
  draft_cancel jsonb := '{"action":"open_verified_cancellation","reason":"Synthetic cancellation","idempotencyKey":"cancel-open-verified"}';
  confirm_cancel jsonb := '{"action":"cancel_with_verified_refunds","reason":"Synthetic cancellation","idempotencyKey":"cancel-confirm-verified"}';
BEGIN
  IF has_function_privilege('authenticated','public.register_paid_order_tender_receipt(uuid,text,text,text,bigint,timestamptz)','EXECUTE')
    OR has_function_privilege('authenticated','public.register_paid_order_verified_refund(uuid,uuid,text,text,text,text,bigint)','EXECUTE')
    OR has_table_privilege('authenticated','private.paid_order_verified_refund_evidence','SELECT') THEN
    RAISE EXCEPTION 'Verification authority leaked to an authenticated client';
  END IF;

  FOREACH method IN ARRAY ARRAY['cash','pos','downgrade','bank_transfer'] LOOP
    f := pg_temp.verified_funding_fixture('credit_direct',false,
      CASE WHEN method = 'downgrade' THEN -2000000 ELSE 2000000 END);
    o := (f->>'order')::uuid;
    m := (f->>'merchant')::uuid;
    lender := (f#>>'{captureIds,0}')::uuid;
    SELECT gateway_reference INTO STRICT capture_reference FROM public.transactions WHERE id = lender;
    UPDATE private.paid_order_amendment_config SET verified_cash_pos_enabled = true,
      verified_credit_direct_refunds_enabled = true,
      scenarios = array_append(scenarios,'verified_funds:serialized_variant:downgrade')
    WHERE merchant_id = m;

    receipt := (f->>'bankEvidenceId')::uuid;
    IF method IN ('cash','pos') THEN
      SELECT bank_account_id INTO STRICT bank_account
      FROM private.paid_order_amendment_config WHERE merchant_id = m;
      DELETE FROM private.paid_order_bank_evidence WHERE id = receipt;
      PERFORM set_config('request.jwt.claim.role','service_role',true);
      IF method = 'pos' THEN
        FOREACH paid_reference IN ARRAY ARRAY['SHORT7','ABCDEFG','-POS-12345'] LOOP
          BEGIN
            PERFORM public.register_paid_order_tender_receipt(
              o,method,paid_reference,'AUDITED-REGISTER-' || o,2000000,now());
            RAISE EXCEPTION 'An invalid POS receipt reference was accepted';
          EXCEPTION WHEN raise_exception THEN
            IF SQLERRM <> 'tender_evidence_required' THEN RAISE; END IF;
          END;
        END LOOP;
        BEGIN
          PERFORM public.register_paid_order_tender_receipt(
            o,method,'POS12345','AUDITED-REGISTER-' || o,2000000,now());
          RAISE EXCEPTION 'accepted eight-character POS reference';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM <> 'accepted eight-character POS reference' THEN RAISE; END IF;
        END;
      END IF;
      receipt := public.register_paid_order_tender_receipt(o,method,'FIXTURE-' || o,'AUDITED-REGISTER-' || o,2000000,now());
      IF public.register_paid_order_tender_receipt(o,method,'fixture-' || o,'AUDITED-REGISTER-' || o,2000000,now()) <> receipt THEN
        RAISE EXCEPTION 'Verified receipt ingestion was not idempotent';
      END IF;
      IF method = 'pos' THEN
        UPDATE private.paid_order_bank_evidence
        SET bank_transaction_id = 'tender:pos:-POS-12345'
        WHERE id = receipt;
        IF public.register_paid_order_tender_receipt(
          o,method,'-POS-12345','AUDITED-REGISTER-' || o,2000000,now()) <> receipt THEN
          RAISE EXCEPTION 'Previously accepted punctuation-led POS reference did not replay';
        END IF;
        UPDATE private.paid_order_bank_evidence
        SET bank_transaction_id = 'tender:pos:' || upper('FIXTURE-' || o)
        WHERE id = receipt;
      END IF;
      BEGIN
        PERFORM public.register_paid_order_tender_receipt(o,method,'FIXTURE-' || o,'AUDITED-REGISTER-' || o,1999999,now());
        RAISE EXCEPTION 'A verified receipt amount was overwritten';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'bank_evidence_conflict' THEN RAISE; END IF;
      END;
      BEGIN
        UPDATE private.paid_order_amendment_config
        SET bank_account_id = gen_random_uuid(),bank_evidence_cutover = now()
        WHERE merchant_id = m;
        RAISE EXCEPTION 'Bank account rotated with an unresolved tender receipt';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'bank_return_claim_open' THEN RAISE; END IF;
      END;
      IF (SELECT bank_account_id FROM private.paid_order_amendment_config WHERE merchant_id = m)
        IS DISTINCT FROM bank_account THEN
        RAISE EXCEPTION 'Rejected unresolved-tender rotation changed the configured account';
      END IF;
    END IF;

    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub',f->>'actor',true);
    IF method = 'downgrade' THEN
      BEGIN
        PERFORM public.preview_paid_order_amendment(o,jsonb_build_object('lineId',f->>'line',
          'replacement',jsonb_build_object('id',f->>'variant','kind','variant')));
        RAISE EXCEPTION 'Unapproved lender downgrade was quoted';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'verified_funding_refund_review_required' THEN RAISE; END IF;
      END;
      UPDATE private.paid_order_verified_funding
      SET lender_amendment_approval_reference = 'LENDER-APPROVED-' || o WHERE order_id = o;
    END IF;
    quote := public.preview_paid_order_amendment(o,jsonb_build_object('lineId',f->>'line',
      'replacement',jsonb_build_object('id',f->>'variant','kind','variant')));
    IF method <> 'downgrade' AND quote#>>'{bankEvidence,0,method}' IS DISTINCT FROM method THEN
      RAISE EXCEPTION 'The verified receipt method disappeared from the quote: %',quote;
    END IF;
    payload := jsonb_build_object('previewId',quote->>'previewId','customerAgreed',true,
      'reason','Synthetic replacement','idempotencyKey','verified-tender-confirm');
    IF receipt IS NOT NULL THEN payload := payload || jsonb_build_object('bankEvidenceId',receipt); END IF;
    result := public.confirm_paid_order_amendment(o,payload);
    amendment := (result->>'amendmentId')::uuid;
    IF public.confirm_paid_order_amendment(o,payload) IS DISTINCT FROM result THEN
      RAISE EXCEPTION 'Confirmation replay drift';
    END IF;
    IF method = 'downgrade' THEN
      IF result->>'state' IS DISTINCT FROM 'awaiting_refund' THEN RAISE EXCEPTION 'Expected explicit lender hold'; END IF;
      payload := '{"action":"record_verified_lender_refund","idempotencyKey":"fixture-lender-refund"}';
      BEGIN
        PERFORM public.run_paid_order_amendment_action(o,amendment,payload);
        RAISE EXCEPTION 'Unverified refund posted';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'refund_evidence_required' THEN RAISE; END IF;
      END;
      PERFORM set_config('request.jwt.claim.role','service_role',true);
      PERFORM set_config('request.jwt.claim.sub','',true);
      PERFORM public.register_paid_order_verified_refund(o,lender,capture_reference,'downgrade',
        'LENDER-ADJUSTMENT-' || o,'FINANCE-RECONCILED-' || o,2000000);
      PERFORM set_config('request.jwt.claim.role','authenticated',true);
      PERFORM set_config('request.jwt.claim.sub',f->>'actor',true);
      result := public.run_paid_order_amendment_action(o,amendment,payload);
      IF result->>'state' IS DISTINCT FROM 'settled'
        OR public.run_paid_order_amendment_action(o,amendment,payload) IS DISTINCT FROM result
        OR (SELECT count(*) FROM public.transactions WHERE order_id = o AND transaction_type = 'refund') <> 1
        OR (public.read_paid_order_amendment_document(o,'current')#>>'{inputs,order,amount_paid}')::numeric
          IS DISTINCT FROM 109867.50::numeric THEN
        RAISE EXCEPTION 'Verified partial lender refund, replay or invoice drift';
      END IF;
    ELSE
      IF result->>'state' IS DISTINCT FROM 'settled' THEN RAISE EXCEPTION 'Expected settled top-up'; END IF;
      SELECT id,gateway_reference INTO STRICT paid_leg,paid_reference FROM public.transactions
      WHERE order_id = o AND transaction_type = 'payment' AND gateway = 'manual'
        AND amount = 20000 AND metadata->>'payment_method' = method;
      IF method IN ('cash','pos') THEN
        BEGIN
          UPDATE private.paid_order_amendment_config
          SET bank_account_id = gen_random_uuid(),bank_evidence_cutover = now()
          WHERE merchant_id = m;
          RAISE EXCEPTION 'Bank account rotated before an allocated top-up could be returned';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM <> 'bank_return_claim_open' THEN RAISE; END IF;
        END;
        IF (SELECT bank_account_id FROM private.paid_order_amendment_config WHERE merchant_id = m)
          IS DISTINCT FROM bank_account THEN
          RAISE EXCEPTION 'Rejected allocated-top-up rotation changed the configured account';
        END IF;
      END IF;
    END IF;

    PERFORM pg_temp.assert_verified_tender_cancellation(
      f,method,o,m,lender,capture_reference,paid_leg,paid_reference,amendment,receipt,bank_account);
  END LOOP;
END;
$$;
ROLLBACK;
