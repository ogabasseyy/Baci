RESET ROLE;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $refund_demo$
DECLARE
  target_order uuid;
  target_attempt uuid;
  captured_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  payment_row public.transactions%ROWTYPE;
  capture_receipt jsonb;
  reserved_refund record;
  replayed_refund record;
  submission_claim record;
  recorded_submission record;
  reconciliation_claim record;
  reconciled_refund record;
  lifecycle_row private.uba_redvault_refund_lifecycle%ROWTYPE;
  rejected_message text;
BEGIN
  IF current_user <> 'postgres' OR current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION 'refund_demo_requires_owner_with_triggers_enabled';
  END IF;
  SELECT order_id,attempt_id INTO STRICT target_order,target_attempt FROM public_test_orders WHERE actor='guest';
  SELECT * INTO STRICT captured_attempt FROM private.uba_redvault_payment_attempts WHERE id=target_attempt;
  SELECT * INTO STRICT payment_row FROM public.transactions
    WHERE order_id=target_order AND gateway_reference=captured_attempt.reference AND transaction_type='payment';
  IF captured_attempt.amount_kobo <> 10250 OR captured_attempt.currency <> 'NGN'
    OR payment_row.amount <> 102.5 OR payment_row.status <> 'pending' THEN
    RAISE EXCEPTION 'refund_demo_capture_fixture_mismatch';
  END IF;
  capture_receipt := public.capture_or_hold_uba_redvault_payment(
    payment_row.id,target_order,'paystack',captured_attempt.reference,
    jsonb_build_object('reference',captured_attempt.reference,'amount',10250,'currency','NGN','status','success','fees',0));
  IF capture_receipt->>'kind' IS DISTINCT FROM 'captured_held'
    OR (SELECT state FROM private.uba_redvault_payment_attempts WHERE id=target_attempt) IS DISTINCT FROM 'captured_held' THEN
    RAISE EXCEPTION 'refund_demo_capture_not_held:%',capture_receipt;
  END IF;
  SELECT * INTO STRICT reserved_refund FROM public.reserve_uba_redvault_refund_v2(
    target_attempt,captured_attempt.merchant_id,'public-product-owner-refund-demo-v1','full_capture',NULL);
  IF reserved_refund.amount_kobo <> 10250 OR reserved_refund.state <> 'pending' THEN
    RAISE EXCEPTION 'refund_demo_reserve_mismatch';
  END IF;
  SELECT * INTO STRICT replayed_refund FROM public.reserve_uba_redvault_refund_v2(
    target_attempt,captured_attempt.merchant_id,'public-product-owner-refund-demo-v1','full_capture',NULL);
  IF replayed_refund.id IS DISTINCT FROM reserved_refund.id OR replayed_refund.amount_kobo <> 10250 THEN
    RAISE EXCEPTION 'refund_demo_idempotency_failed';
  END IF;
  SELECT * INTO STRICT submission_claim FROM public.claim_next_uba_redvault_refund();
  IF submission_claim.id IS DISTINCT FROM reserved_refund.id OR submission_claim.state <> 'processing' THEN
    RAISE EXCEPTION 'refund_demo_submission_claim_mismatch';
  END IF;
  SELECT * INTO STRICT recorded_submission FROM public.record_uba_redvault_refund_provider_submission(
    reserved_refund.id,'synthetic-dashboard-refund-20261018-0001','pending');
  IF recorded_submission.provider_reference IS DISTINCT FROM 'synthetic-dashboard-refund-20261018-0001' THEN
    RAISE EXCEPTION 'refund_demo_submission_reference_mismatch';
  END IF;
  SELECT * INTO STRICT reconciliation_claim FROM public.claim_next_uba_redvault_refund_reconciliation();
  IF reconciliation_claim.id IS DISTINCT FROM reserved_refund.id OR reconciliation_claim.reconciliation_claim_token IS NULL THEN
    RAISE EXCEPTION 'refund_demo_reconciliation_claim_mismatch';
  END IF;
  BEGIN
    PERFORM public.reconcile_uba_redvault_refund(reserved_refund.id,
      '00000000-0000-4000-8000-000000000000'::uuid,'processed','synthetic-dashboard-refund-20261018-0001');
  EXCEPTION WHEN OTHERS THEN rejected_message:=SQLERRM;
  END;
  IF rejected_message IS DISTINCT FROM 'redvault_refund_reconciliation_claim_invalid' THEN
    RAISE EXCEPTION 'refund_demo_bad_fence_not_rejected:%',COALESCE(rejected_message,'accepted');
  END IF;
  SELECT * INTO STRICT reconciled_refund FROM public.reconcile_uba_redvault_refund(
    reserved_refund.id,reconciliation_claim.reconciliation_claim_token,'processed','synthetic-dashboard-refund-20261018-0001');
  IF reconciled_refund.id IS DISTINCT FROM reserved_refund.id OR reconciled_refund.state <> 'processed'
    OR (SELECT count(*) FROM private.uba_redvault_refunds WHERE attempt_id=target_attempt) <> 1
    OR (SELECT sum(amount_kobo) FROM private.uba_redvault_refunds WHERE attempt_id=target_attempt AND state='processed') <> 10250
    OR (SELECT payment_status FROM public.orders WHERE id=target_order) IS DISTINCT FROM 'refunded'
    OR (SELECT status FROM public.transactions WHERE id=payment_row.id) IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'refund_demo_financial_finalization_failed';
  END IF;
  SELECT * INTO STRICT lifecycle_row FROM private.uba_redvault_refund_lifecycle WHERE refund_id=reserved_refund.id;
  IF lifecycle_row.financial_state IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'refund_demo_lifecycle_financial_state_failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shipments WHERE order_id=target_order)
    OR EXISTS (SELECT 1 FROM public.orders WHERE id=target_order AND
      (shipment_id IS NOT NULL OR tracking_number IS NOT NULL OR shipped_at IS NOT NULL OR delivered_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'refund_demo_physical_hold_failed';
  END IF;
  RAISE NOTICE 'DEMO PASS: guest held capture; full refund=10250 NGN kobo; stable idempotency; submission recorded; wrong fence rejected; protected reconciliation processed; order/transaction refunded; lifecycle financial=%, inventory=%, review=%',
    lifecycle_row.financial_state,lifecycle_row.inventory_state,lifecycle_row.review_reason;
END;
$refund_demo$;
RESET ROLE;
