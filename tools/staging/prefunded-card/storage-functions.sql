BEGIN;

CREATE FUNCTION prefunded_card.valid_terminal_evidence(evidence jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
  IF evidence IS NULL OR jsonb_typeof(evidence)<>'object' OR jsonb_typeof(evidence->'amountKobo') IS DISTINCT FROM 'number'
    OR (evidence->>'amountKobo') !~ '^[1-9][0-9]{0,15}$' THEN RETURN false; END IF;
  RETURN (evidence->>'amountKobo')::numeric <= 9007199254740991;
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.lock_scoped_operation(p_operation uuid, p_dispatch boolean DEFAULT false)
RETURNS prefunded_card.operations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'prefunded operation isolation denied' USING ERRCODE='42501';
  END IF;
  SELECT treasury_binding_id INTO operation.treasury_binding_id FROM prefunded_card.operations WHERE id=p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded operation unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id FOR UPDATE;
  IF NOT FOUND OR binding.authorized_login<>session_user THEN
    RAISE EXCEPTION 'prefunded operation denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO operation FROM prefunded_card.operations WHERE id=p_operation FOR UPDATE;
  IF NOT FOUND OR operation.integration_id<>binding.integration_id OR operation.merchant_id<>binding.merchant_id THEN
    RAISE EXCEPTION 'prefunded operation scope stale' USING ERRCODE='42501';
  END IF;
  IF NOT p_dispatch THEN RETURN operation; END IF;
  IF NOT binding.enabled OR binding.verified_at<clock_timestamp()-interval '15 minutes'
    OR binding.verified_at>clock_timestamp()+interval '1 minute' THEN
    RAISE EXCEPTION 'prefunded operation treasury stale' USING ERRCODE='42501';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry WHERE registry.id=binding.integration_id
    AND registry.enabled AND registry.expected_provider_account_id=binding.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded registry stale' USING ERRCODE='42501'; END IF;
  PERFORM ledger.goal_id FROM piggyvest_savings_ledger.bindings ledger WHERE ledger.integration_id=operation.integration_id
    AND ledger.merchant_id=operation.merchant_id AND ledger.customer_id=operation.customer_id AND ledger.goal_id=operation.goal_id
    AND ledger.enabled AND ledger.authorized_login=session_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded ledger binding stale' USING ERRCODE='42501'; END IF;
  PERFORM mapping.goal_id FROM piggyvest_staging.wallet_goal_mappings mapping WHERE mapping.integration_id=operation.integration_id
    AND mapping.merchant_id=operation.merchant_id AND mapping.customer_id=operation.customer_id AND mapping.goal_id=operation.goal_id
    AND mapping.provider_wallet_id=operation.destination_wallet_id AND mapping.provider_customer_id=operation.destination_customer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded mapping stale' USING ERRCODE='42501'; END IF;
  PERFORM customer.id FROM public.customers customer WHERE customer.id=operation.customer_id
    AND customer.merchant_id=operation.merchant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded customer stale' USING ERRCODE='42501'; END IF;
  PERFORM method.id FROM public.customer_saved_payment_methods method WHERE method.id=operation.saved_method_id
    AND method.merchant_id=operation.merchant_id AND method.customer_id=operation.customer_id AND method.provider='paystack'
    AND method.reusable AND method.is_active AND method.disabled_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded saved method stale' USING ERRCODE='42501'; END IF;
  PERFORM goal.id FROM public.customer_savings_goals goal WHERE goal.id=operation.goal_id AND goal.merchant_id=operation.merchant_id
    AND goal.customer_id=operation.customer_id AND goal.status='active' AND goal.completed_at IS NULL
    AND goal.cancelled_at IS NULL AND goal.spent_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded goal stale' USING ERRCODE='42501'; END IF;
  RETURN operation;
END $$;

CREATE FUNCTION prefunded_card.request_for_operation(operation prefunded_card.operations) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('operationId',operation.id,'integrationId',operation.integration_id,
    'merchantId',operation.merchant_id,'customerId',operation.customer_id,'goalId',operation.goal_id,
    'treasuryBindingId',binding.id,'businessId',binding.expected_business_id,'sourceWalletId',binding.source_wallet_id,
    'collectionReference',operation.collection_reference,'transferReference',operation.transfer_reference,
    'amountKobo',operation.amount_kobo,'currency',operation.currency,'savedMethodId',operation.saved_method_id,
    'destinationWalletId',operation.destination_wallet_id,'destinationCustomerId',operation.destination_customer_id)
  FROM prefunded_card.treasury_bindings binding WHERE binding.id=operation.treasury_binding_id
    AND binding.authorized_login=session_user AND binding.integration_id=operation.integration_id
    AND binding.merchant_id=operation.merchant_id;
$$;

CREATE OR REPLACE FUNCTION prefunded_card.claim_collection(p_operation uuid,p_fence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation,true);
  IF p_fence IS NULL OR operation.collection_status<>'not_started' OR operation.collection_fence IS DISTINCT FROM p_fence THEN RETURN jsonb_build_object('outcome','stale_or_reconciliation_required'); END IF;
  UPDATE prefunded_card.operations SET collection_status='dispatching',collection_fence=collection_fence+1,collection_attempted_at=clock_timestamp() WHERE id=p_operation;
  RETURN jsonb_build_object('outcome','claimed','operationId',p_operation,'fence',p_fence+1,'request',prefunded_card.request_for_operation(operation));
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.claim_transfer(p_operation uuid,p_fence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation,true);
  IF p_fence IS NULL OR operation.collection_status<>'verified_success' OR operation.transfer_status<>'not_started' OR operation.transfer_fence IS DISTINCT FROM p_fence THEN RETURN jsonb_build_object('outcome','stale_or_reconciliation_required'); END IF;
  UPDATE prefunded_card.operations SET transfer_status='dispatching',transfer_fence=transfer_fence+1,transfer_attempted_at=clock_timestamp() WHERE id=p_operation;
  RETURN jsonb_build_object('outcome','claimed','operationId',p_operation,'fence',p_fence+1,'request',prefunded_card.request_for_operation(operation));
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.claim_reconciliation(p_operation uuid,p_lease_seconds integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; token uuid:=gen_random_uuid();
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'invalid verification lease' USING ERRCODE='22023'; END IF;
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  IF operation.collection_status NOT IN ('dispatching','pending','unknown') AND operation.transfer_status NOT IN ('dispatching','pending','unknown') THEN RETURN jsonb_build_object('outcome','not_verifiable'); END IF;
  IF operation.verification_lease_expires_at>clock_timestamp() THEN RETURN jsonb_build_object('outcome','leased'); END IF;
  UPDATE prefunded_card.operations SET verification_fence=verification_fence+1,verification_token=token,verification_lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds) WHERE id=p_operation;
  RETURN jsonb_build_object('outcome','verify_only','operationId',p_operation,'token',token,'fence',operation.verification_fence+1,
    'leg',CASE WHEN operation.collection_status IN ('dispatching','pending','unknown') THEN 'collection' ELSE 'transfer' END,
    'request',prefunded_card.request_for_operation(operation));
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.complete_reconciliation(p_operation uuid,p_token uuid,p_fence bigint,p_leg text,p_outcome text,p_evidence jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id;
  IF p_token IS NULL OR p_fence IS NULL OR operation.verification_token IS DISTINCT FROM p_token OR operation.verification_fence IS DISTINCT FROM p_fence OR operation.verification_lease_expires_at IS NULL OR operation.verification_lease_expires_at<=clock_timestamp() THEN RETURN 'stale'; END IF;
  IF p_leg IS NULL OR p_leg NOT IN ('collection','transfer') OR p_outcome IS NULL OR p_outcome NOT IN ('verified_success','verified_failed') THEN RETURN 'reconciliation_required'; END IF;
  IF NOT prefunded_card.valid_terminal_evidence(p_evidence) THEN
    UPDATE prefunded_card.operations SET projection_status='reconciliation_required' WHERE id=p_operation;
    RETURN 'reconciliation_required';
  END IF;
  IF p_leg='collection' AND operation.collection_status IN ('dispatching','pending','unknown') AND p_evidence->>'reference'=operation.collection_reference AND p_evidence->>'currency'=operation.currency AND (p_evidence->>'amountKobo')::bigint=operation.amount_kobo AND p_evidence->>'savedMethodId'=operation.saved_method_id::text AND nullif(p_evidence->>'providerTransactionId','') IS NOT NULL THEN
    UPDATE prefunded_card.operations SET collection_status=CASE WHEN p_outcome='verified_success' THEN 'verified_success' WHEN p_outcome='verified_failed' THEN 'verified_failed' ELSE 'unknown' END,collection_provider_transaction_id=p_evidence->>'providerTransactionId',verification_token=NULL,verification_lease_expires_at=NULL WHERE id=p_operation;
    IF p_outcome='verified_failed' THEN UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-operation.amount_kobo WHERE id=operation.treasury_binding_id; END IF;
    RETURN p_outcome;
  END IF;
  IF p_leg='transfer' AND operation.transfer_status IN ('dispatching','pending','unknown') AND p_outcome='verified_success' AND p_evidence->>'reference'=operation.transfer_reference AND p_evidence->>'businessId'=binding.expected_business_id AND p_evidence->>'sourceWalletId'=binding.source_wallet_id AND p_evidence->>'destinationWalletId'=operation.destination_wallet_id AND p_evidence->>'destinationCustomerId'=operation.destination_customer_id AND p_evidence->>'currency'=operation.currency AND (p_evidence->>'amountKobo')::bigint=operation.amount_kobo AND nullif(p_evidence->>'providerTransactionId','') IS NOT NULL THEN
    UPDATE prefunded_card.operations SET transfer_status='verified_success',transfer_provider_transaction_id=p_evidence->>'providerTransactionId',verification_token=NULL,verification_lease_expires_at=NULL WHERE id=p_operation;
    UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-operation.amount_kobo,consumed_kobo=consumed_kobo+operation.amount_kobo WHERE id=operation.treasury_binding_id;
    RETURN 'verified_success';
  END IF;
  UPDATE prefunded_card.operations SET projection_status='reconciliation_required' WHERE id=p_operation;
  RETURN 'reconciliation_required';
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.record_collection(p_operation uuid,p_fence bigint,p_outcome text,p_evidence jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  IF p_fence IS NULL OR operation.collection_status<>'dispatching' OR operation.collection_fence IS DISTINCT FROM p_fence THEN RETURN 'stale'; END IF;
  IF p_outcome='unknown' THEN UPDATE prefunded_card.operations SET collection_status='unknown' WHERE id=p_operation; RETURN 'unknown'; END IF;
  IF NOT prefunded_card.valid_terminal_evidence(p_evidence) THEN
    UPDATE prefunded_card.operations SET collection_status='unknown',projection_status='reconciliation_required' WHERE id=p_operation;
    RETURN 'reconciliation_required';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('verified_success','verified_failed') OR p_evidence IS NULL OR p_evidence->>'reference' IS DISTINCT FROM operation.collection_reference OR p_evidence->>'currency' IS DISTINCT FROM operation.currency OR (p_evidence->>'amountKobo')::bigint IS DISTINCT FROM operation.amount_kobo OR p_evidence->>'savedMethodId' IS DISTINCT FROM operation.saved_method_id::text OR nullif(p_evidence->>'providerTransactionId','') IS NULL THEN UPDATE prefunded_card.operations SET collection_status='unknown',projection_status='reconciliation_required' WHERE id=p_operation; RETURN 'reconciliation_required'; END IF;
  UPDATE prefunded_card.operations SET collection_status=CASE WHEN p_outcome='verified_success' THEN 'verified_success' ELSE 'verified_failed' END,collection_provider_transaction_id=p_evidence->>'providerTransactionId' WHERE id=p_operation;
  IF p_outcome='verified_failed' THEN UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-operation.amount_kobo WHERE id=operation.treasury_binding_id; END IF;
  RETURN p_outcome;
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.record_transfer(p_operation uuid,p_fence bigint,p_outcome text,p_evidence jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation); SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id;
  IF p_fence IS NULL OR operation.transfer_status<>'dispatching' OR operation.transfer_fence IS DISTINCT FROM p_fence THEN RETURN 'stale'; END IF;
  IF p_outcome='unknown' THEN UPDATE prefunded_card.operations SET transfer_status='unknown' WHERE id=p_operation; RETURN 'unknown'; END IF;
  IF NOT prefunded_card.valid_terminal_evidence(p_evidence) THEN
    UPDATE prefunded_card.operations SET transfer_status='unknown',projection_status='reconciliation_required' WHERE id=p_operation;
    RETURN 'reconciliation_required';
  END IF;
  IF p_outcome IS NULL OR p_outcome<>'verified_success' OR p_evidence IS NULL OR p_evidence->>'reference' IS DISTINCT FROM operation.transfer_reference OR p_evidence->>'businessId' IS DISTINCT FROM binding.expected_business_id OR p_evidence->>'sourceWalletId' IS DISTINCT FROM binding.source_wallet_id OR p_evidence->>'destinationWalletId' IS DISTINCT FROM operation.destination_wallet_id OR p_evidence->>'destinationCustomerId' IS DISTINCT FROM operation.destination_customer_id OR p_evidence->>'currency' IS DISTINCT FROM operation.currency OR (p_evidence->>'amountKobo')::bigint IS DISTINCT FROM operation.amount_kobo OR nullif(p_evidence->>'providerTransactionId','') IS NULL THEN UPDATE prefunded_card.operations SET transfer_status='unknown',projection_status='reconciliation_required' WHERE id=p_operation; RETURN 'reconciliation_required'; END IF;
  UPDATE prefunded_card.operations SET transfer_status='verified_success',transfer_provider_transaction_id=p_evidence->>'providerTransactionId' WHERE id=p_operation;
  UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-operation.amount_kobo,consumed_kobo=consumed_kobo+operation.amount_kobo WHERE id=operation.treasury_binding_id;
  RETURN 'verified_success';
END $$;

REVOKE ALL ON FUNCTION prefunded_card.lock_scoped_operation(uuid,boolean),prefunded_card.complete_reconciliation(uuid,uuid,bigint,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA prefunded_card FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
