\set ON_ERROR_STOP on
\ir fixtures/paid-order-amendments/settlement-setup.inc.sql
\ir fixtures/paid-order-amendments/verified-funding-setup.inc.sql

BEGIN;
DO $$
DECLARE
  fixture jsonb := pg_temp.amendment_settlement_seed(2000000);
  order_id uuid := (fixture->>'order')::uuid;
  merchant_id uuid := (fixture->>'merchant')::uuid;
  method text;
  result jsonb;
BEGIN
  FOREACH method IN ARRAY ARRAY['cash','pos'] LOOP
    BEGIN
      result := public.record_manual_order_payment(merchant_id,order_id,20000,'NGN',
        'SYNTHETIC-' || method,'Synthetic Android top-up',
        jsonb_build_object('payment_method',method),'android-amendment-top-up-' || method);
      RAISE EXCEPTION 'unverified % top-up unexpectedly returned %',method,result;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT IN ('bank_evidence_required','bank_evidence_conflict','amendment_hold') THEN
        RAISE;
      END IF;
    END;
  END LOOP;
  IF (SELECT o.amount_paid FROM public.orders o WHERE o.id = order_id) IS DISTINCT FROM 300000::numeric
    OR (SELECT count(*) FROM public.transactions t WHERE t.order_id = (fixture->>'order')::uuid) <> 1
    OR (SELECT a.state FROM private.paid_order_amendments a WHERE a.id = (fixture->>'amendment')::uuid)
      IS DISTINCT FROM 'awaiting_payment' THEN
    RAISE EXCEPTION 'rejected top-up changed the ledger or amendment state';
  END IF;
END;
$$;

DO $$
DECLARE
  fixture jsonb := pg_temp.verified_funding_fixture('credit_direct',false,0);
  order_id uuid := (fixture->>'order')::uuid;
  merchant_id uuid := (fixture->>'merchant')::uuid;
  quote jsonb;
  result jsonb;
  method text;
BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',fixture->>'actor',true);
  quote := public.preview_paid_order_amendment(order_id,jsonb_build_object('lineId',fixture->>'line',
    'replacement',jsonb_build_object('id',fixture->>'variant','kind','variant')));
  result := public.confirm_paid_order_amendment(order_id,jsonb_build_object('previewId',quote->>'previewId',
    'customerAgreed',true,'reason','Synthetic same-price swap','idempotencyKey','manual-payment-boundary'));
  IF result->>'state' IS DISTINCT FROM 'settled'
    OR public.read_paid_order_amendment_workspace(order_id)->>'isVerifiedFunding' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'The fixture did not create a verified-funded amendment';
  END IF;
  FOREACH method IN ARRAY ARRAY['cash','pos'] LOOP
    result := public.record_manual_order_payment(merchant_id,order_id,20000,'NGN',
      'SYNTHETIC-VERIFIED-' || method,'Synthetic ordinary top-up',
      jsonb_build_object('payment_method',method),'ordinary-verified-amendment-' || method);
    IF result->>'error_code' IS DISTINCT FROM 'ORDER_ALREADY_PAID' THEN
      RAISE EXCEPTION 'Ordinary % payment returned % on a settled verified amendment',method,result;
    END IF;
  END LOOP;
  IF (SELECT o.amount_paid FROM public.orders o WHERE o.id = order_id) IS DISTINCT FROM 129867.50::numeric
    OR (SELECT count(*) FROM public.transactions t WHERE t.order_id = (fixture->>'order')::uuid) <> 1 THEN
    RAISE EXCEPTION 'Rejected ordinary payment changed the verified funding ledger';
  END IF;
END;
$$;
ROLLBACK;
