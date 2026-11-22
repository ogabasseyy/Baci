\set ON_ERROR_STOP on
\ir fixtures/paid-order-amendments/settlement-setup.inc.sql

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
ROLLBACK;
