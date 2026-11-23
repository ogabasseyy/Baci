\set ON_ERROR_STOP on
\ir fixtures/paid-order-amendments/settlement-setup.inc.sql
BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(-5000000);
  a uuid := (f->>'amendment')::uuid;
  o uuid := (f->>'order')::uuid;
  m uuid := (f->>'merchant')::uuid;
  attempt uuid;
  local_refund uuid;
  claim jsonb;
  evidence jsonb;
BEGIN
  IF has_function_privilege('anon','public.resolve_paid_order_amendment_refund_preflight(uuid,text[],text[])','EXECUTE')
    OR has_function_privilege('authenticated','public.resolve_paid_order_amendment_refund_preflight(uuid,text[],text[])','EXECUTE') THEN
    RAISE EXCEPTION 'preflight clearance is not restricted to the worker';
  END IF;
  SELECT id INTO STRICT attempt FROM private.paid_order_amendment_refunds WHERE amendment_id = a;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  claim := public.claim_paid_order_amendment_refund(attempt);
  IF (claim->>'submit')::boolean IS DISTINCT FROM true
    OR public.authorize_paid_order_amendment_refund_dispatch(attempt,false,ARRAY['786']) THEN
    RAISE EXCEPTION 'competing preflight authorized a refund request';
  END IF;

  UPDATE private.paid_order_amendment_config SET enabled = false,automated_paystack_refunds = false
    WHERE merchant_id = m;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM pg_temp.amendment_action(f,jsonb_build_object('action','refresh_refund_status',
    'operationId',attempt,'idempotencyKey','fixture-competing-refresh'));
  IF (public.read_paid_order_amendment_workspace(o)#>>'{refunds,0,preflightReview}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'staff workspace did not distinguish a preflight review from a submitted refund';
  END IF;

  PERFORM set_config('request.jwt.claim.role','service_role',true);
  claim := public.claim_paid_order_amendment_refund(attempt);
  IF (claim->>'preflightReview')::boolean IS DISTINCT FROM true
    OR (claim->>'submit')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'review polled the undispatched refund instead of the capture';
  END IF;
  evidence := jsonb_build_object('reference',claim->>'reference','transactionId','531',
    'integration','987','domain','test','currency','NGN','amount',5000000,'id','787','status','processed');
  IF public.record_paid_order_amendment_refund(claim->>'reference',evidence) IS DISTINCT FROM 'evidence_mismatch'
    OR public.find_paid_order_amendment_refund(NULL,NULL,claim->>'captureReference') IS NOT NULL THEN
    RAISE EXCEPTION 'an unsent attempt accepted refund evidence or captured an unrelated webhook';
  END IF;
  IF public.resolve_paid_order_amendment_refund_preflight(attempt,ARRAY[]::text[],ARRAY['786']) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'a competing provider refund cleared the hold';
  END IF;

  IF public.resolve_paid_order_amendment_refund_preflight(attempt,ARRAY['785'],ARRAY[]::text[]) IS DISTINCT FROM false
    OR public.resolve_paid_order_amendment_refund_preflight(attempt,ARRAY[]::text[],ARRAY[]::text[]) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'a missing competing refund was treated as failed';
  END IF;
  -- Simulate a historical local refund row written before the current guard.
  ALTER TABLE public.transactions DISABLE TRIGGER paid_order_amendment_refund_write;
  INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway)
    VALUES (m,o,'refund',50000,'NGN','pending','manual') RETURNING id INTO local_refund;
  ALTER TABLE public.transactions ENABLE TRIGGER paid_order_amendment_refund_write;
  IF public.resolve_paid_order_amendment_refund_preflight(attempt,ARRAY['786'],ARRAY[]::text[]) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'clear provider history obscured a competing local refund';
  END IF;
  UPDATE public.transactions SET status = 'failed' WHERE id = local_refund;
  IF public.resolve_paid_order_amendment_refund_preflight(attempt,ARRAY['786'],ARRAY[]::text[]) IS DISTINCT FROM true
    OR public.resolve_paid_order_amendment_refund_preflight(attempt,ARRAY['786'],ARRAY[]::text[]) IS DISTINCT FROM false
    OR public.claim_paid_order_amendment_refund(attempt) IS NOT NULL
    OR public.authorize_paid_order_amendment_refund_dispatch(attempt,true)
    OR (SELECT hold_fulfillment FROM private.paid_order_amendments WHERE id = a) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'clearing review bypassed the refund pause or released the hold';
  END IF;

  UPDATE private.paid_order_amendment_config SET automated_paystack_refunds = true WHERE merchant_id = m;
  claim := public.claim_paid_order_amendment_refund(attempt);
  IF (claim->>'submit')::boolean IS DISTINCT FROM true
    OR public.authorize_paid_order_amendment_refund_dispatch(attempt,true) IS DISTINCT FROM true
    OR public.authorize_paid_order_amendment_refund_dispatch(attempt,true)
    OR public.record_paid_order_amendment_refund(claim->>'reference',evidence || '{"status":"needs_attention"}')
       IS DISTINCT FROM 'needs_attention' THEN
    RAISE EXCEPTION 'requeued refund could not dispatch exactly once';
  END IF;
  UPDATE private.paid_order_amendment_refunds SET next_lookup_at = transaction_timestamp() WHERE id = attempt;
  claim := public.claim_paid_order_amendment_refund(attempt);
  IF (claim->>'submit')::boolean IS DISTINCT FROM false
    OR (claim->>'preflightReview')::boolean IS DISTINCT FROM false
    OR public.resolve_paid_order_amendment_refund_preflight(attempt,ARRAY['786'],ARRAY[]::text[]) IS DISTINCT FROM false
    OR public.record_paid_order_amendment_refund(claim->>'reference',evidence) IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'provider needs-attention regressed into preflight or failed reconciliation';
  END IF;
END;
$$;
ROLLBACK;
