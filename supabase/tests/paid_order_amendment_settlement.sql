\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('public.run_paid_order_amendment_action(uuid,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'amendment settlement commands are missing';
  END IF;
END;
$$;
ROLLBACK;

\ir fixtures/paid-order-amendments/settlement-setup.inc.sql

BEGIN;
DO $$
DECLARE
  held jsonb := pg_temp.amendment_settlement_seed(-5000000);
  eligible jsonb := pg_temp.amendment_settlement_seed(0);
  held_order uuid := (held->>'order')::uuid;
  eligible_order uuid := (eligible->>'order')::uuid;
  held_wallet uuid := (held->>'wallet')::uuid;
  eligible_wallet uuid := (eligible->>'wallet')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.process_due_settlements();

  IF (SELECT status FROM public.merchant_settlements WHERE source_id = held_order) IS DISTINCT FROM 'pending'
    OR EXISTS (SELECT 1 FROM public.wallet_transactions WHERE source_id = held_order AND type = 'credit')
    OR (SELECT upcoming_balance FROM public.merchant_wallets WHERE id = held_wallet) IS DISTINCT FROM 299000
    OR (SELECT available_balance FROM public.merchant_wallets WHERE id = held_wallet) IS DISTINCT FROM 0
    OR (SELECT status FROM public.merchant_settlements WHERE source_id = eligible_order) IS DISTINCT FROM 'settled'
    OR (SELECT count(*) FROM public.wallet_transactions WHERE source_id = eligible_order AND type = 'credit') <> 1
    OR (SELECT available_balance FROM public.merchant_wallets WHERE id = eligible_wallet) IS DISTINCT FROM 299000
  THEN
    RAISE EXCEPTION 'due settlements did not preserve only the open amendment refund hold';
  END IF;

  PERFORM public.process_due_settlements();
  IF (SELECT count(*) FROM public.wallet_transactions WHERE source_id = eligible_order AND type = 'credit') <> 1
    OR EXISTS (SELECT 1 FROM public.wallet_transactions WHERE source_id = held_order AND type = 'credit')
  THEN
    RAISE EXCEPTION 'repeat settlement released held money or credited twice';
  END IF;

  IF (SELECT image_url FROM public.order_items WHERE id = (held->>'line')::uuid)
    IS DISTINCT FROM 'https://example.invalid/replacement.png'
  THEN RAISE EXCEPTION 'confirmed replacement retained the original image snapshot'; END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',held->>'actor',true);
  PERFORM pg_temp.amendment_action(held,'{"action":"reverse","reason":"Fixture image reversal","idempotencyKey":"fixture-image-reversal"}');
  IF (SELECT image_url FROM public.order_items WHERE id = (held->>'line')::uuid)
    IS DISTINCT FROM 'https://example.invalid/original-snapshot.png'
  THEN RAISE EXCEPTION 'reversal failed to restore the original image snapshot'; END IF;
END;
$$;
ROLLBACK;
BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(5000000);
  o uuid := (f->>'order')::uuid;
  m uuid := (f->>'merchant')::uuid;
  short_evidence uuid := pg_temp.amendment_bank(f,4000000);
  exact_evidence uuid := pg_temp.amendment_bank(f,5000000);
  late_evidence uuid;
  outgoing uuid;
  claim uuid;
  payload jsonb;
  paid_transaction uuid;
  unlinked_refund uuid;
  result jsonb;
BEGIN
  IF has_function_privilege('authenticated','public.register_paid_order_bank_evidence(uuid,text,text,bigint,timestamp with time zone,text,uuid,uuid)','EXECUTE')
    OR has_table_privilege('authenticated','private.paid_order_bank_evidence','UPDATE') THEN
    RAISE EXCEPTION 'verified bank authority leaked to a shopper';
  END IF;
  payload := jsonb_build_object('action','record_top_up','evidenceId',short_evidence,'idempotencyKey','fixture-short');
  result := pg_temp.amendment_action(f,payload);
  IF result->>'outcome' IS DISTINCT FROM 'unapplied' OR pg_temp.amendment_action(f,payload) IS DISTINCT FROM result
    OR (SELECT amount_paid FROM public.orders WHERE id = o) <> 300000 THEN
    RAISE EXCEPTION 'short transfer affected paid total or was not idempotent';
  END IF;
  claim := (pg_temp.amendment_action(f,jsonb_build_object('action','claim_offline_disbursement',
    'sourceKind','unapplied','sourceId',short_evidence,'idempotencyKey','fixture-claim')) ->>'claimId')::uuid;
  BEGIN
    PERFORM pg_temp.amendment_action(f,'{"action":"reverse","reason":"fixture reversal","idempotencyKey":"fixture-race-reverse"}');
    RAISE EXCEPTION 'reversal could race an unresolved bank payout';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_payment_open' THEN RAISE; END IF;
  END;
  outgoing := pg_temp.amendment_bank(f,4000000,short_evidence);
  payload := jsonb_build_object('action','record_offline_refund','claimId',claim,'evidenceId',outgoing,'idempotencyKey','fixture-return');
  IF pg_temp.amendment_action(f,payload)->>'outcome' IS DISTINCT FROM 'verified'
    OR pg_temp.amendment_action(f,payload)->>'outcome' IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'outgoing verified evidence did not finish return exactly once';
  END IF;
  payload := jsonb_build_object('action','record_top_up','evidenceId',exact_evidence,'idempotencyKey','fixture-exact');
  result := pg_temp.amendment_action(f,payload);
  IF result->>'state' IS DISTINCT FROM 'settled' OR (result->>'holdFulfillment')::boolean
    OR pg_temp.amendment_action(f,payload) IS DISTINCT FROM result
    OR (SELECT amount_paid FROM public.orders WHERE id = o) <> 350000
    OR (SELECT count(*) FROM public.transactions WHERE order_id = o) <> 2 THEN
    RAISE EXCEPTION 'exact top-up did not post one payment and release fulfillment';
  END IF;
  SELECT transaction_id INTO STRICT paid_transaction FROM private.paid_order_bank_evidence WHERE id = exact_evidence;
  PERFORM public.cancel_order_as_merchant(o,'Synthetic mixed cancellation','automatic');
  claim := (pg_temp.amendment_action(f,jsonb_build_object('action','claim_offline_disbursement',
    'sourceKind','cancellation_leg','sourceId',paid_transaction,'idempotencyKey','fixture-cancel-offline'))->>'claimId')::uuid;
  BEGIN
    PERFORM pg_temp.amendment_action(f,jsonb_build_object('action','record_offline_refund',
      'claimId',claim,'evidenceId',outgoing,'idempotencyKey','fixture-reuse-out'));
    RAISE EXCEPTION 'outgoing evidence was reused';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_evidence_conflict' THEN RAISE; END IF;
  END;
  outgoing := pg_temp.amendment_bank(f,5000000,exact_evidence);
  late_evidence := pg_temp.amendment_bank(f,5000000);
  BEGIN
    UPDATE private.paid_order_amendment_config SET bank_account_id = NULL,bank_evidence_cutover = NULL WHERE merchant_id = m;
    RAISE EXCEPTION 'An open cancellation claim allowed bank account rotation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_return_claim_open' THEN RAISE; END IF;
  END;
  IF (SELECT bank_account_id FROM private.paid_order_amendment_config WHERE merchant_id = m)
    IS DISTINCT FROM (f->>'bank')::uuid THEN
    RAISE EXCEPTION 'Rejected account rotation changed the configured bank';
  END IF;
  BEGIN
    INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway,metadata)
    VALUES (m,o,'refund',50000,'NGN','completed','manual',jsonb_build_object('payment_transaction_id',paid_transaction));
    RAISE EXCEPTION 'clearing the pilot account bypassed historical disbursement ownership';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_disbursement_evidence_required' THEN RAISE; END IF;
  END;
  INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway)
  VALUES (m,o,'refund',50000,'NGN','pending','manual') RETURNING id INTO unlinked_refund;
  BEGIN
    UPDATE public.transactions SET metadata = jsonb_build_object('payment_transaction_id',paid_transaction)
    WHERE id = unlinked_refund;
    RAISE EXCEPTION 'a metadata-only update assigned an unverified bank refund';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_disbursement_evidence_required' THEN RAISE; END IF;
  END;
  DELETE FROM public.transactions WHERE id = unlinked_refund;
  IF pg_temp.amendment_action(f,jsonb_build_object('action','record_offline_refund',
    'claimId',claim,'evidenceId',outgoing,'idempotencyKey','fixture-cancel-return'))->>'outcome' IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'offline cancellation leg was not covered';
  END IF;
  BEGIN
    UPDATE public.transactions SET metadata = jsonb_build_object('payment_transaction_id',f->>'capture')
    WHERE id = (SELECT transaction_id FROM private.paid_order_bank_evidence WHERE id = outgoing);
    RAISE EXCEPTION 'a metadata-only update moved verified disbursement evidence';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_evidence_conflict' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.transactions WHERE order_id = o AND transaction_type = 'refund'
    AND amount = 50000 AND metadata->>'payment_transaction_id' = paid_transaction::text) <> 1
    OR (SELECT count(*) FROM public.transactions WHERE order_id = o AND gateway = 'paystack' AND amount = 300000) <> 1 THEN
    RAISE EXCEPTION 'mixed cancellation counted a returned transfer or lost the Paystack funding leg';
  END IF;
  UPDATE private.paid_order_amendment_config SET bank_account_id = (f->>'bank')::uuid,
    bank_evidence_cutover = now()-interval '1 day' WHERE merchant_id = m;
  IF pg_temp.amendment_action(f,jsonb_build_object('action','record_top_up','evidenceId',late_evidence,
      'idempotencyKey','fixture-late-cancelled'))->>'outcome' IS DISTINCT FROM 'unapplied' THEN
    RAISE EXCEPTION 'late money was allocated to a cancelled order';
  END IF;
  claim := (pg_temp.amendment_action(f,jsonb_build_object('action','claim_offline_disbursement',
    'sourceKind','unapplied','sourceId',late_evidence,'idempotencyKey','fixture-late-claim'))->>'claimId')::uuid;
  outgoing := pg_temp.amendment_bank(f,5000000,late_evidence);
  PERFORM pg_temp.amendment_action(f,jsonb_build_object('action','record_offline_refund','claimId',claim,
    'evidenceId',outgoing,'idempotencyKey','fixture-late-return'));
  IF (SELECT cancelled_at IS NULL OR amount_paid <> 350000 FROM public.orders WHERE id = o)
    OR (SELECT count(*) FROM public.transactions WHERE order_id = o AND transaction_type = 'refund') <> 1 THEN
    RAISE EXCEPTION 'returning post-cancellation money altered the order ledger';
  END IF;
  UPDATE private.paid_order_amendment_config
  SET bank_account_id = NULL,bank_evidence_cutover = NULL WHERE merchant_id = m;
  BEGIN
    INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway,metadata)
    VALUES (m,o,'refund',50000,'NGN','completed','manual',jsonb_build_object('payment_transaction_id',paid_transaction));
    RAISE EXCEPTION 'Clearing the account bypassed historical disbursement ownership';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_disbursement_evidence_required' THEN RAISE; END IF;
  END;
END;
$$;
ROLLBACK;

BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(-5000000);
  a uuid := (f->>'amendment')::uuid;
  o uuid := (f->>'order')::uuid;
  attempt uuid;
  old_attempt uuid;
  cancellation_refund uuid;
  claim jsonb;
  evidence jsonb;
  result jsonb;
BEGIN
  SELECT id INTO STRICT attempt FROM private.paid_order_amendment_refunds WHERE amendment_id = a;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  claim := public.claim_paid_order_amendment_refund(attempt);
  IF (claim->>'submit')::boolean IS DISTINCT FROM true OR public.claim_paid_order_amendment_refund(attempt) IS NOT NULL
    OR NOT public.authorize_paid_order_amendment_refund_dispatch(attempt,true) THEN
    RAISE EXCEPTION 'refund lost exclusive durable submission claim';
  END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  BEGIN
    PERFORM pg_temp.amendment_action(f,'{"action":"cancel_for_recovery","reason":"Synthetic recovery","idempotencyKey":"fixture-unsafe-cancel"}');
    RAISE EXCEPTION 'recovery cancellation could over-refund while a provider attempt is uncertain';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_payment_open' THEN RAISE; END IF;
  END;
  evidence := jsonb_build_object('reference',claim->>'reference','transactionId','531','integration','987',
    'domain','test','currency','NGN','amount',5000000,'id','622','status','failed');
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  IF public.record_paid_order_amendment_refund(claim->>'reference',evidence || '{"integration":"999"}') <> 'evidence_mismatch'
    OR public.record_paid_order_amendment_refund(claim->>'reference',evidence) <> 'failed' THEN
    RAISE EXCEPTION 'provider identity validation or terminal failure failed';
  END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  old_attempt := attempt;
  attempt := (pg_temp.amendment_action(f,jsonb_build_object('action','retry_failed_refund','operationId',old_attempt,
    'idempotencyKey','fixture-retry'))->>'operationId')::uuid;
  BEGIN
    PERFORM pg_temp.amendment_action(f,jsonb_build_object('action','retry_failed_refund','operationId',old_attempt,'idempotencyKey','fixture-retry-again'));
    RAISE EXCEPTION 'a failed attempt spawned multiple retries';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'refund_evidence_required' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  claim := public.claim_paid_order_amendment_refund(attempt);
  IF NOT public.authorize_paid_order_amendment_refund_dispatch(attempt,true) THEN
    RAISE EXCEPTION 'refund retry did not obtain dispatch authorization';
  END IF;
  UPDATE private.paid_order_amendment_refunds SET next_lookup_at = now() WHERE id = attempt;
  IF (public.claim_paid_order_amendment_refund(attempt)->>'submit')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'lost provider response should recover via lookup';
  END IF;
  evidence := evidence || jsonb_build_object('reference',claim->>'reference','id','623','status','processed');
  IF public.record_paid_order_amendment_refund(claim->>'reference',evidence) <> 'processed' THEN
    RAISE EXCEPTION 'verified processed refund was not recorded';
  END IF;
  IF public.record_paid_order_amendment_refund(claim->>'reference',evidence || '{"status":"pending"}') <> 'processed'
    OR (SELECT count(*) FROM public.transactions WHERE order_id = o AND transaction_type = 'refund') <> 1
    OR (SELECT hold_fulfillment FROM private.paid_order_amendments WHERE id = a) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'customer refund replay or payout hold failed';
  END IF;
  -- An invalid debit must not consume the one durable finance approval.
  UPDATE public.merchant_settlements SET net_amount = 48000 WHERE source_id = o;
  BEGIN
    PERFORM public.apply_paid_order_amendment_adjustment(attempt,4900000,'synthetic excessive debit');
    RAISE EXCEPTION 'an excessive debit reserved the sole adjustment approval';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid_amendment_adjustment' THEN RAISE; END IF;
  END;
  UPDATE public.merchant_settlements SET net_amount = 299000 WHERE source_id = o;
  UPDATE public.merchant_wallets SET upcoming_balance = 0 WHERE id = (f->>'wallet')::uuid;
  IF public.apply_paid_order_amendment_adjustment(attempt,4900000,'synthetic finance approval')->>'outcome'
    IS DISTINCT FROM 'review' THEN RAISE EXCEPTION 'insufficient wallet exposed a second refund path'; END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM pg_temp.amendment_action(f,jsonb_build_object('action','retry_merchant_adjustment','operationId',attempt,
    'idempotencyKey','fixture-adjustment-retry'));
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  UPDATE public.merchant_wallets SET upcoming_balance = 299000 WHERE id = (f->>'wallet')::uuid;
  IF public.retry_due_paid_order_amendment_adjustments(2) <> 1 THEN
    RAISE EXCEPTION 'approved merchant adjustment was not retried';
  END IF;
  result := public.apply_paid_order_amendment_adjustment(attempt,4900000,'synthetic finance approval');
  IF result->>'state' <> 'settled' OR (result->>'holdFulfillment')::boolean
    OR public.apply_paid_order_amendment_adjustment(attempt,4900000,'synthetic finance approval') IS DISTINCT FROM result
    OR (SELECT net_amount FROM public.merchant_settlements WHERE source_id = o) <> 250000
    OR (SELECT upcoming_balance FROM public.merchant_wallets WHERE id = (f->>'wallet')::uuid) <> 250000
    OR (SELECT amount_paid FROM public.orders WHERE id = o) <> 300000 THEN
    RAISE EXCEPTION 'merchant adjustment double debit, changed gross funds, or failed to release hold';
  END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM public.cancel_order_as_merchant(o,'Synthetic downgrade cancellation','automatic');
  IF (SELECT cancelled_at FROM public.orders WHERE id = o) IS NULL
    OR (SELECT status FROM public.order_cancellation_side_effects WHERE order_id = o AND step = 'refund') IS NULL THEN
    RAISE EXCEPTION 'partial refund did not admit remaining cancellation coverage';
  END IF;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,gateway,gateway_reference,status,metadata)
  VALUES ((f->>'merchant')::uuid,o,'refund',250000,'NGN','paystack','624','refund_pending',
    jsonb_build_object('payment_transaction_id',f->>'capture','provider_transaction_id','531'))
  RETURNING id INTO cancellation_refund;
  FOR replay IN 1..2 LOOP
    IF public.record_verified_paystack_cancellation_refund_v1(cancellation_refund,'processed',531,25000000,'NGN')
      IS DISTINCT FROM 'processed' THEN RAISE EXCEPTION 'cancellation remainder did not reconcile'; END IF;
  END LOOP;
  IF (SELECT payment_status FROM public.orders WHERE id = o) IS DISTINCT FROM 'refunded'
    OR (SELECT sum(amount) FROM public.transactions WHERE order_id = o AND transaction_type = 'refund'
      AND status = 'completed') IS DISTINCT FROM 300000::numeric
    OR (SELECT upcoming_balance FROM public.merchant_wallets WHERE id = (f->>'wallet')::uuid) <> 0
    OR (SELECT status FROM public.merchant_settlements WHERE source_id = o) <> 'cancelled' THEN
    RAISE EXCEPTION 'cancellation replay did not consume just the remaining payment and wallet allocation';
  END IF;
  BEGIN
    UPDATE public.transactions SET status = 'failed'
    WHERE id = (SELECT refund_transaction_id FROM private.paid_order_amendment_refunds WHERE id = attempt);
    RAISE EXCEPTION 'a cancellation writer changed the amendment-owned refund';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_refund_owned' THEN RAISE; END IF;
  END;
END;
$$;
ROLLBACK;

BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(-5000000);
  o uuid := (f->>'order')::uuid;
  a uuid := (f->>'amendment')::uuid;
  attempt uuid;
  reversed jsonb;
BEGIN
  SELECT id INTO STRICT attempt FROM private.paid_order_amendment_refunds WHERE amendment_id = a;
  UPDATE public.products SET stock_quantity = 0 WHERE id = (f->>'source')::uuid;
  BEGIN
    PERFORM pg_temp.amendment_action(f,'{"action":"reverse","reason":"Synthetic reversal","idempotencyKey":"fixture-reverse"}');
    RAISE EXCEPTION 'reversal recreated unavailable stock';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'replacement_unavailable' THEN RAISE; END IF;
  END;
  UPDATE public.products SET stock_quantity = 1 WHERE id = (f->>'source')::uuid;
  reversed := pg_temp.amendment_action(f,'{"action":"reverse","reason":"Synthetic reversal","idempotencyKey":"fixture-reverse"}');
  IF reversed->>'state' <> 'reversed' OR (SELECT total FROM public.orders WHERE id = o) <> 300000
    OR (SELECT product_id FROM public.order_items WHERE order_id = o) <> (f->>'source')::uuid
    OR (SELECT count(*) FROM private.paid_order_amendment_revisions WHERE amendment_id = a) <> 2 THEN
    RAISE EXCEPTION 'reversal did not restore original order and append history';
  END IF;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  IF public.claim_paid_order_amendment_refund(attempt) IS NOT NULL THEN
    RAISE EXCEPTION 'reversed refund was submitted';
  END IF;
END;
$$;
ROLLBACK;


BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(5000000);
  o uuid := (f->>'order')::uuid;
  reference text := 'FIXTURE-RETURNED-CAPTURE';
  evidence jsonb := '{"id":"649","transactionId":"648","status":"processed","integration":"987","currency":"NGN","amount":"30000000"}';
BEGIN
  INSERT INTO private.paid_order_checkout_capture_exceptions(reference,order_id,outcome,reason,
    provider_transaction_id,provider_integration_id,amount_minor,currency)
  VALUES (reference,o,'unapplied','synthetic stale capture','648','987','30000000','NGN');
  BEGIN
    PERFORM pg_temp.amendment_action(f,'{"action":"reverse","reason":"wait for return","idempotencyKey":"fixture-return-and-reverse"}');
    RAISE EXCEPTION 'reversal ignored stale unapplied capture';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_payment_open' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  BEGIN
    PERFORM public.record_paid_order_stale_capture_return(reference,evidence || '{"amount":"29999999"}');
    RAISE EXCEPTION 'a partial stale-capture return released recovery';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'refund_evidence_required' THEN RAISE; END IF;
  END;
  UPDATE private.paid_order_amendment_config SET paystack_integration_id = 889 WHERE merchant_id = (f->>'merchant')::uuid;
  IF NOT public.record_paid_order_stale_capture_return(reference,evidence) THEN
    RAISE EXCEPTION 'verified full stale-capture return did not close the recovery fence';
  END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  IF pg_temp.amendment_action(f,'{"action":"reverse","reason":"verified return","idempotencyKey":"fixture-return-and-reverse"}')
    ->>'state' IS DISTINCT FROM 'reversed' THEN RAISE EXCEPTION 'verified return blocked recovery'; END IF;
END;
$$;
ROLLBACK;


BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(5000000);
  o uuid := (f->>'order')::uuid;
  exact_evidence uuid := pg_temp.amendment_bank(f,5000000);
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.register_paid_order_bank_evidence((f->>'bank')::uuid,gen_random_uuid()::text,
    'incoming',4000000,clock_timestamp()-interval '1 second','bound short transfer',NULL,o);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  BEGIN
    PERFORM pg_temp.amendment_action(f,jsonb_build_object('action','record_top_up',
      'evidenceId',exact_evidence,'idempotencyKey','fixture-bound-evidence'));
    RAISE EXCEPTION 'top-up released fulfillment before a known short transfer was resolved';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_payment_open' THEN RAISE; END IF;
  END;
  IF (SELECT allocation FROM private.paid_order_bank_evidence WHERE id = exact_evidence) IS NOT NULL THEN
    RAISE EXCEPTION 'blocked exact transfer lost its eligibility';
  END IF;
END;
$$;
ROLLBACK;
