\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_merchant uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_payment uuid;
  v_refund uuid;
  v_ref text := 'BAC-FEEREFUND001';
  v_capture jsonb;
  v_metadata jsonb;
  v_candidates jsonb;
  v_verdict text;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
    VALUES (v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'fixture-surcharge-refund@example.invalid',now(),now());
  INSERT INTO public.merchants(id,user_id,email,business_name,slug)
    VALUES (v_merchant,v_owner,'fixture-surcharge-refund@example.invalid','Surcharge Refund Fixture','fixture-surcharge-refund');
  INSERT INTO private.paid_order_amendment_config(merchant_id,version,enabled,paystack_integration_id,integration_wallet_checkout)
    VALUES (v_merchant,1,false,987,true);
  INSERT INTO public.orders(id,merchant_id,order_number,source,currency,payment_method,
    payment_status,shipping_status,total,subtotal,amount_paid,tracking_token,customer_email)
    VALUES (v_order,v_merchant,'FIXTURE-SURCHARGE-REFUND','online_store','NGN','card',
      'unpaid','pending',100,100,0,'synthetic-surcharge-proof','fixture-surcharge-shopper@example.invalid');
  UPDATE private.paid_order_amendment_config SET integration_wallet_checkout = false WHERE merchant_id = v_merchant;
  BEGIN
    PERFORM public.claim_checkout_for_paid_order_amendment(v_order,'synthetic-surcharge-proof','paystack_no_subaccount',
      v_ref,'NGN',10000);
    RAISE EXCEPTION 'checkout claimed without a subaccount or integration wallet';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_gateway_not_configured' THEN RAISE; END IF;
  END;
  UPDATE private.paid_order_amendment_config SET integration_wallet_checkout = true WHERE merchant_id = v_merchant;
  BEGIN
    PERFORM public.claim_checkout_for_paid_order_amendment(v_order,'synthetic-surcharge-proof','paystack_no_subaccount',
      v_ref,'NGN',10000,200,1);
    RAISE EXCEPTION 'changed shipping economics created a checkout claim';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_payment_details_changed' THEN RAISE; END IF;
  END;
  IF public.claim_checkout_for_paid_order_amendment(v_order,'synthetic-surcharge-proof','paystack_no_subaccount',
    v_ref,'NGN',10000,200,0) IS DISTINCT FROM 'claimed_integration' THEN
    RAISE EXCEPTION 'integration wallet checkout was not bound';
  END IF;
  v_capture := jsonb_build_object('id',345,'reference',v_ref,'integration',987,'domain','test',
    'status','success','currency','NGN','channel','card','amount',10157,'requested_amount',10000,
    'fees',157,'subaccount',NULL,'fees_split',NULL);
  IF public.resolve_paid_order_checkout_capture(v_ref,v_capture,100)->>'outcome' IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'surcharge capture fixture was not independently verified';
  END IF;
  SELECT id INTO STRICT v_payment FROM public.transactions WHERE gateway_reference = v_ref;
  PERFORM public.complete_order_gateway_payment(v_payment,v_order,v_capture,'fixture-webhook',NULL);
  IF (SELECT gateway_response->>'baci_paystack_checkout_customer_fee_minor'
    FROM public.transactions WHERE id = v_payment) IS DISTINCT FROM '157' THEN
    RAISE EXCEPTION 'capture did not acquire the certified fee proof';
  END IF;
  PERFORM public.record_merchant_settlement(v_merchant,'order',v_order,'paystack',
    v_ref,100,0,1,'Synthetic integration-wallet capture','{"paystack_collection":"integration"}');
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions WHERE id = v_payment AND amount = 100 AND status = 'completed'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.merchant_settlements s
    JOIN public.merchant_wallets w ON w.id = s.wallet_id
    WHERE s.source_id = v_order AND s.status = 'pending'
      AND s.gross_amount = 100 AND s.net_amount = 99 AND w.upcoming_balance = 99
      AND s.metadata->>'paystack_collection' = 'integration'
  ) THEN
    RAISE EXCEPTION 'integration-wallet settlement did not use the order principal';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM public.cancel_order_as_merchant(v_order,'fixture cancellation','automatic');
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_metadata := jsonb_build_object('payment_transaction_id',v_payment,
    'provider_payment_transaction_id','345','provider_refund_amount_minor',10157);
  BEGIN
    INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,gateway,gateway_reference,status,metadata)
      VALUES (v_merchant,v_order,'refund',99,'NGN','paystack','810','refund_pending',v_metadata);
    RAISE EXCEPTION 'partial surcharge refund was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'refund_evidence_mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,gateway,gateway_reference,status,metadata)
      VALUES (v_merchant,v_order,'refund',100,'NGN','paystack','810','refund_pending',v_metadata - 'provider_refund_amount_minor');
    RAISE EXCEPTION 'surcharge refund missing provider amount was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'refund_evidence_mismatch' THEN RAISE; END IF;
  END;
  INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,gateway,gateway_reference,status,metadata)
    VALUES (v_merchant,v_order,'refund',100,'NGN','paystack','810','refund_pending',v_metadata)
    RETURNING id INTO v_refund;
  BEGIN
    PERFORM public.record_verified_paystack_cancellation_refund_v1(v_refund,'processed',345,10000,'NGN');
    RAISE EXCEPTION 'principal-only provider proof was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'refund_evidence_mismatch' THEN RAISE; END IF;
  END;
  v_verdict := public.record_verified_paystack_cancellation_refund_v1(v_refund,'processed',345,10157,'NGN');
  IF v_verdict IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'certified gross rejected: %', v_verdict;
  END IF;
  v_verdict := public.record_verified_paystack_cancellation_refund_v1(v_refund,'processed',345,10157,'NGN');
  IF v_verdict IS DISTINCT FROM 'processed'
    OR NOT EXISTS (SELECT 1 FROM public.transactions WHERE id = v_refund AND amount = 100 AND status = 'completed')
    OR (SELECT payment_status FROM public.orders WHERE id = v_order) IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'certified gross did not idempotently refund the principal';
  END IF;
  BEGIN
    INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,gateway,gateway_reference,status,metadata)
      VALUES (v_merchant,v_order,'refund',100,'NGN','paystack','811','refund_pending',v_metadata);
    RAISE EXCEPTION 'a second provider refund for the same surcharge capture was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'refund_evidence_mismatch' THEN RAISE; END IF;
  END;
  v_candidates := public.open_paystack_refund_recovery_watch_v1(v_ref,811,
    jsonb_build_object('provider_refund_status','processed'));
  IF v_candidates#>>'{0,gateway_response,baci_paystack_checkout_customer_fee_minor}' IS DISTINCT FROM '157'
    OR v_candidates#>>'{0,gateway_response,amount}' IS DISTINCT FROM '10157' THEN
    RAISE EXCEPTION 'refund-before-local-write recovery lost the certified amount';
  END IF;
END;
$$;
ROLLBACK;
