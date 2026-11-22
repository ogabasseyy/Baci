\set ON_ERROR_STOP on
\ir fixtures/paid-order-amendments/settlement-setup.inc.sql
BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(-5000000);
  candidate jsonb := pg_temp.amendment_settlement_seed(0,(f->>'merchant')::uuid,false);
  o uuid := (f->>'order')::uuid;
  a uuid := (f->>'amendment')::uuid;
  other uuid := (candidate->>'order')::uuid;
  merchant uuid := (f->>'merchant')::uuid;
  attempt uuid;
  operation jsonb;
  original jsonb;
  refund_id uuid;
  remainder uuid;
  reconciliation text;
BEGIN
  SELECT id INTO STRICT attempt FROM private.paid_order_amendment_refunds WHERE amendment_id = a;
  -- The worker normally polls in its own transaction after the confirmation commits.
  UPDATE private.paid_order_amendment_refunds SET next_lookup_at = transaction_timestamp() WHERE id = attempt;
  original := public.read_paid_order_amendment_document(o,'original')->'inputs';
  UPDATE private.paid_order_amendment_config SET enabled = false,version = version+1 WHERE merchant_id = merchant;

  IF (public.read_paid_order_amendment_workspace(other)->>'canStart')::boolean IS DISTINCT FROM false
    OR public.read_paid_order_amendment_workspace(o)#>>'{customer,state}' IS DISTINCT FROM 'awaiting_refund' THEN
    RAISE EXCEPTION 'pause failed to hide new changes or hid the open refund';
  END IF;
  BEGIN
    PERFORM public.confirm_paid_order_amendment(other,jsonb_build_object('previewId',candidate->>'preview',
      'customerAgreed',true,'reason','Synthetic paused attempt','idempotencyKey','fixture-paused-attempt'));
    RAISE EXCEPTION 'pause admitted a new confirmation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'scenario_disabled' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = other)
    OR (SELECT product_id FROM public.order_items WHERE order_id = other) IS DISTINCT FROM (candidate->>'source')::uuid
    OR (SELECT count(*) FROM public.transactions WHERE order_id = other) <> 1 THEN
    RAISE EXCEPTION 'rejected confirmation moved stock or money';
  END IF;
  IF public.confirm_paid_order_amendment(o,jsonb_build_object('previewId',f->>'preview','customerAgreed',true,
      'reason','Synthetic swap','idempotencyKey','fixture-confirm'))->>'amendmentId' IS DISTINCT FROM a::text THEN
    RAISE EXCEPTION 'pause hid the existing confirmation receipt';
  END IF;

  PERFORM set_config('request.jwt.claim.role','service_role',true);
  IF NOT EXISTS (SELECT 1 FROM public.list_due_paid_order_amendment_refunds(20) AS due(id) WHERE id = attempt) THEN
    RAISE EXCEPTION 'pausing admissions stranded the queued refund';
  END IF;
  operation := public.claim_paid_order_amendment_refund(attempt);
  IF (operation->>'submit')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'paused admission prevented the queued refund preflight';
  END IF;
  -- The separate refund control still stops money egress after a worker has leased preflight.
  UPDATE private.paid_order_amendment_config SET automated_paystack_refunds = false WHERE merchant_id = merchant;
  IF public.authorize_paid_order_amendment_refund_dispatch(attempt,true) THEN
    RAISE EXCEPTION 'the dedicated refund kill switch allowed a new provider submission';
  END IF;
  UPDATE private.paid_order_amendment_config SET automated_paystack_refunds = true WHERE merchant_id = merchant;
  IF NOT public.authorize_paid_order_amendment_refund_dispatch(attempt,true)
    OR public.authorize_paid_order_amendment_refund_dispatch(attempt,true) THEN
    RAISE EXCEPTION 'paused admission prevented the existing refund or let it submit twice';
  END IF;
  -- Once sent, independent refund pause must still allow lookup and verified evidence.
  UPDATE private.paid_order_amendment_config SET automated_paystack_refunds = false WHERE merchant_id = merchant;
  UPDATE private.paid_order_amendment_refunds SET next_lookup_at = clock_timestamp() WHERE id = attempt;
  IF (public.claim_paid_order_amendment_refund(attempt)->>'submit')::boolean IS DISTINCT FROM false
    OR public.record_paid_order_amendment_refund(operation->>'reference',jsonb_build_object(
      'reference',operation->>'reference','transactionId','531','integration','987','domain','test',
      'currency','NGN','amount',5000000,'id','782','status','processed')) IS DISTINCT FROM 'processed'
    OR public.apply_paid_order_amendment_adjustment(attempt,4900000,'synthetic pause reconciliation')->>'state'
      IS DISTINCT FROM 'settled' THEN
    RAISE EXCEPTION 'paused refund lost reconciliation or merchant settlement';
  END IF;
  SELECT refund_transaction_id INTO STRICT refund_id FROM private.paid_order_amendment_refunds WHERE id = attempt;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.read_paid_order_amendment_workspace(o)->'events') AS event
    WHERE event->>'type' = 'merchant_adjustment_applied')
    OR public.read_paid_order_amendment_document(o,'original')->'inputs' IS DISTINCT FROM original
    OR (public.read_paid_order_amendment_document(o,'current')#>>'{inputs,order,amount_paid}')::numeric IS DISTINCT FROM 250000::numeric THEN
    RAISE EXCEPTION 'pause lost the audit or document history';
  END IF;
  PERFORM public.cancel_order_as_merchant(o,'Synthetic pause cancellation','automatic');
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,gateway,gateway_reference,status,metadata)
  VALUES (merchant,o,'refund',250000,'NGN','paystack','783','refund_pending',
    jsonb_build_object('payment_transaction_id',f->>'capture','provider_transaction_id','531'))
  RETURNING id INTO remainder;
  reconciliation := public.record_verified_paystack_cancellation_refund_v1(remainder,'processed',531,25000000,'NGN');
  IF reconciliation IS DISTINCT FROM 'processed'
    OR (SELECT sum(amount) FROM public.transactions WHERE order_id = o AND transaction_type = 'refund'
      AND status = 'completed') IS DISTINCT FROM 300000::numeric
    OR (SELECT stock_quantity FROM public.products WHERE id = (f->>'source')::uuid) <> 1
    OR (SELECT stock_quantity FROM public.products WHERE id = (f->>'replacement')::uuid) <> 1 THEN
    RAISE EXCEPTION 'ordinary cancellation during pause lost refund attribution or restocked twice';
  END IF;
  RAISE NOTICE 'pause evidence order=% original-capture=% partial-refund=% cancellation-refund=%',
    left(o::text,8),left(f->>'capture',8),left(refund_id::text,8),left(remainder::text,8);
END;
$$;
ROLLBACK;

BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(0);
  ordinary jsonb := pg_temp.amendment_settlement_seed(0,(f->>'merchant')::uuid,false);
  o uuid := (f->>'order')::uuid;
  ordinary_id uuid := (ordinary->>'order')::uuid;
  merchant uuid := (f->>'merchant')::uuid;
  refund uuid;
BEGIN
  IF (SELECT count(*) FROM public.transactions WHERE order_id = o) <> 1
    OR EXISTS (SELECT 1 FROM private.paid_order_amendment_refunds WHERE amendment_id = (f->>'amendment')::uuid)
    OR (SELECT product_id FROM public.order_items WHERE order_id = o) IS DISTINCT FROM (f->>'replacement')::uuid
    OR (public.read_paid_order_amendment_workspace(o)#>>'{customer,holdFulfillment}')::boolean IS DISTINCT FROM false
    OR public.read_paid_order_amendment_document(o,'original')#>>'{inputs,items,0,name}' IS DISTINCT FROM 'Original' THEN
    RAISE EXCEPTION 'equal swap moved money, lost the invoice or allocated the wrong replacement';
  END IF;
  UPDATE private.paid_order_amendment_config SET enabled = false,version = version+1 WHERE merchant_id = merchant;
  PERFORM public.cancel_order_as_merchant(ordinary_id,'Synthetic ordinary order while paused','automatic');
  PERFORM public.cancel_order_as_merchant(o,'Synthetic equal swap cancellation','automatic');
  IF NOT EXISTS (SELECT 1 FROM public.order_cancellation_side_effects WHERE order_id = ordinary_id AND step = 'refund')
    OR (SELECT stock_quantity FROM public.products WHERE id = (ordinary->>'source')::uuid) <> 1
    OR (SELECT stock_quantity FROM public.products WHERE id = (f->>'source')::uuid) <> 1
    OR (SELECT stock_quantity FROM public.products WHERE id = (f->>'replacement')::uuid) <> 1 THEN
    RAISE EXCEPTION 'paused ordinary or equal cancellation lost its refund job or restocked incorrectly';
  END IF;

  PERFORM set_config('request.jwt.claim.role','service_role',true);
  -- Synthetic provider outcome for the ordinary cancellation worker's verified receipt.
  INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,gateway,gateway_reference,status,metadata)
  VALUES (merchant,o,'refund',300000,'NGN','paystack','784','refund_pending',
    jsonb_build_object('payment_transaction_id',f->>'capture','provider_transaction_id','531'))
  RETURNING id INTO refund;
  IF public.record_verified_paystack_cancellation_refund_v1(refund,'processed',531,30000000,'NGN') IS DISTINCT FROM 'processed'
    OR public.record_verified_paystack_cancellation_refund_v1(refund,'processed',531,30000000,'NGN') IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'same-price cancellation failed to reconcile the full original capture';
  END IF;
  IF (SELECT count(*) FROM public.transactions WHERE order_id = o AND transaction_type = 'refund'
    AND status = 'completed' AND amount = 300000) <> 1 OR
    (SELECT payment_status FROM public.orders WHERE id = o) IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'equal cancellation did not refund exactly once';
  END IF;
  RAISE NOTICE 'equal evidence order=% original-capture=% cancellation-refund=% ordinary-order=%',
    left(o::text,8),left(f->>'capture',8),left(refund::text,8),left(ordinary_id::text,8);
END;
$$;
ROLLBACK;

BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(0,NULL,false);
  merchant uuid := (f->>'merchant')::uuid;
  o uuid := (f->>'order')::uuid;
  fresh_order uuid := gen_random_uuid();
  proof text := 'synthetic-pause-checkout-proof';
  selection jsonb := jsonb_build_object('lineId',f->>'line',
    'replacement',jsonb_build_object('kind','product','id',f->>'replacement'));
BEGIN
  UPDATE public.orders SET source = 'partner' WHERE id = o;
  BEGIN
    PERFORM public.preview_paid_order_amendment(o,selection);
    RAISE EXCEPTION 'partner order entered the pilot';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_ineligible' THEN RAISE; END IF;
  END;
  UPDATE public.orders SET source = 'online_store',payment_method = 'bank_transfer' WHERE id = o;
  BEGIN
    PERFORM public.preview_paid_order_amendment(o,selection);
    RAISE EXCEPTION 'unqualified transfer entered the pilot';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_ineligible' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = o)
    OR (SELECT count(*) FROM public.transactions WHERE order_id = o) <> 1
    OR (SELECT product_id FROM public.order_items WHERE order_id = o) IS DISTINCT FROM (f->>'source')::uuid THEN
    RAISE EXCEPTION 'ineligible instrument moved stock or money';
  END IF;

  UPDATE private.paid_order_amendment_config SET enabled = false,version = version+1 WHERE merchant_id = merchant;
  INSERT INTO public.orders(id,merchant_id,order_number,source,currency,payment_status,shipping_status,total,subtotal,tracking_token)
  VALUES (fresh_order,merchant,fresh_order::text,'online_store','NGN','pending','pending',300000,300000,proof);
  PERFORM set_config('request.jwt.claim.role','anon',true);
  BEGIN
    PERFORM public.claim_checkout_for_paid_order_amendment(fresh_order,proof,'paystack_dva','BAC-CHECKOUT0001','NGN',30000000);
    RAISE EXCEPTION 'configured checkout accepted an unqualified DVA instrument';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_ineligible' THEN RAISE; END IF;
  END;
  IF public.claim_checkout_for_paid_order_amendment(fresh_order,proof,'paystack','BAC-CHECKOUT0001','NGN',30000000)
    IS DISTINCT FROM 'claimed' THEN
    RAISE EXCEPTION 'admission pause interrupted the configured ordinary card route';
  END IF;
END;
$$;
ROLLBACK;
