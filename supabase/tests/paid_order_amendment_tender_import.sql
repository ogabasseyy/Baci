\set ON_ERROR_STOP on
\ir fixtures/paid-order-amendments/verified-funding-setup.inc.sql

BEGIN;
DO $$
DECLARE
  a jsonb := pg_temp.verified_funding_fixture('credit_direct');
  b jsonb := pg_temp.verified_funding_fixture('credit_direct');
  merchant uuid := (a->>'merchant')::uuid;
  template jsonb := jsonb_build_object('method','cash','receiptReference','VALID-RECEIPT-01',
    'reconciliationReference','CLOSEOUT-123','amountMinor',2000000,'occurredAt',now());
  local_receipt jsonb := template || jsonb_build_object('orderId',a->>'order');
  foreign_receipt jsonb := template || jsonb_build_object('orderId',b->>'order','receiptReference','FOREIGN-RECEIPT-01');
  ids jsonb;
BEGIN
  IF has_function_privilege('authenticated','public.import_paid_order_tender_receipts(uuid,text,jsonb)','EXECUTE')
    OR has_function_privilege('anon','public.import_paid_order_tender_receipts(uuid,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Tender importer can bypass the trusted verification worker';
  END IF;
  DELETE FROM private.paid_order_bank_evidence WHERE bound_order_id IN ((a->>'order')::uuid,(b->>'order')::uuid);
  UPDATE private.paid_order_amendment_config SET verified_cash_pos_enabled = true
  WHERE merchant_id IN (merchant,(b->>'merchant')::uuid);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  BEGIN
    PERFORM public.import_paid_order_tender_receipts(merchant,'finance-till',
      jsonb_build_array(local_receipt,foreign_receipt));
    RAISE EXCEPTION 'Cross-merchant receipt was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'tender_evidence_required' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.import_paid_order_tender_receipts(merchant,'finance-till',
      jsonb_build_array(local_receipt,local_receipt || '{"receiptReference":"Z-INVALID-AMOUNT","amountMinor":0}'));
    RAISE EXCEPTION 'Invalid receipt batch was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'tender_evidence_required' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM private.paid_order_bank_evidence
    WHERE bound_order_id IN ((a->>'order')::uuid,(b->>'order')::uuid)) THEN
    RAISE EXCEPTION 'An invalid batch wrote partial evidence';
  END IF;
  ids := public.import_paid_order_tender_receipts(merchant,'finance-till',jsonb_build_array(local_receipt));
  IF jsonb_array_length(ids) IS DISTINCT FROM 1
    OR public.import_paid_order_tender_receipts(merchant,'finance-till',jsonb_build_array(local_receipt)) IS DISTINCT FROM ids
    OR NOT EXISTS (SELECT 1 FROM private.paid_order_bank_evidence
      WHERE id = (ids->>0)::uuid AND bound_order_id = (a->>'order')::uuid AND amount_minor = 2000000
        AND statement_entry = 'finance-till/CLOSEOUT-123' AND collection_method = 'cash')
  THEN RAISE EXCEPTION 'Signed receipt scope, audit or replay drift'; END IF;
END;
$$;
ROLLBACK;
