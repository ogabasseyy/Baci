CREATE FUNCTION prefunded_card.retire_unconfirmed_checkout(p_approval jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE; operation prefunded_card.operations%ROWTYPE;
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE; scope jsonb; field_name text; saved jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper)
    OR current_user IS DISTINCT FROM session_user OR current_setting('transaction_isolation')<>'read committed'
    OR jsonb_typeof(p_approval) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'checkout retirement owner denied' USING ERRCODE='42501'; END IF;
  scope:='{}'::jsonb;
  FOREACH field_name IN ARRAY ARRAY['deployment','integrationId','merchantId','treasuryBindingId','businessId','systemIdentifier','expiresAt'] LOOP
    scope:=scope||jsonb_build_object(field_name,p_approval->field_name);
  END LOOP;
  PERFORM prefunded_card.checkout_validate_scope(scope,true);
  SELECT * INTO STRICT binding FROM prefunded_card.treasury_bindings WHERE id=(scope->>'treasuryBindingId')::uuid FOR UPDATE;
  SELECT * INTO STRICT intent FROM prefunded_card.checkout_intents WHERE id=(p_approval->>'intentId')::uuid FOR UPDATE;
  SELECT * INTO STRICT operation FROM prefunded_card.operations WHERE id=intent.operation_id FOR UPDATE;
  IF intent.id IS DISTINCT FROM intent.operation_id OR intent.integration_id IS DISTINCT FROM binding.integration_id
    OR intent.merchant_id IS DISTINCT FROM binding.merchant_id OR intent.treasury_binding_id IS DISTINCT FROM binding.id
    OR intent.business_id IS DISTINCT FROM binding.expected_business_id OR intent.system_identifier IS DISTINCT FROM scope->>'systemIdentifier'
    OR intent.database_name IS DISTINCT FROM current_database() OR intent.authorized_login IS DISTINCT FROM binding.authorized_login
    OR intent.integration_id::text IS DISTINCT FROM scope->>'integrationId' OR intent.merchant_id::text IS DISTINCT FROM scope->>'merchantId'
    OR intent.business_id IS DISTINCT FROM scope->>'businessId' OR intent.expires_at IS DISTINCT FROM (scope->>'expiresAt')::timestamptz
    OR intent.customer_id::text IS DISTINCT FROM p_approval->>'customerId' OR intent.actor_id::text IS DISTINCT FROM p_approval->>'actorId'
    OR intent.goal_id::text IS DISTINCT FROM p_approval->>'goalId' OR intent.amount_kobo::text IS DISTINCT FROM p_approval->>'amountKobo'
    OR intent.reference IS DISTINCT FROM p_approval->>'reference' OR intent.request_fingerprint IS DISTINCT FROM p_approval->>'requestFingerprint'
    OR operation.integration_id IS DISTINCT FROM intent.integration_id OR operation.merchant_id IS DISTINCT FROM intent.merchant_id
    OR operation.customer_id IS DISTINCT FROM intent.customer_id OR operation.goal_id IS DISTINCT FROM intent.goal_id
    OR operation.treasury_binding_id IS DISTINCT FROM intent.treasury_binding_id OR operation.amount_kobo IS DISTINCT FROM intent.amount_kobo
    OR operation.currency IS DISTINCT FROM 'NGN' OR intent.currency IS DISTINCT FROM 'NGN'
    OR operation.collection_reference IS DISTINCT FROM intent.reference OR operation.transfer_reference IS DISTINCT FROM intent.transfer_reference
    OR operation.request_fingerprint IS DISTINCT FROM intent.request_fingerprint
    OR p_approval->'evidence'->>'operatorApproval' IS DISTINCT FROM 'retire-unconfirmed-test-checkout-v1'
    OR p_approval->'evidence'->>'providerResult' IS DISTINCT FROM 'transaction_not_found'
    OR p_approval->'evidence'->'providerHttp' IS DISTINCT FROM '400'::jsonb
    OR coalesce(p_approval->'evidence'->>'configurationSha256','') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'checkout retirement scope denied' USING ERRCODE='42501'; END IF;
  SELECT approval INTO saved FROM prefunded_card.checkout_retirements WHERE operation_id=intent.id;
  IF FOUND THEN
    IF intent.phase<>'retired_unconfirmed' OR NOT operation.checkout_retired
      OR (saved-'evidence') IS DISTINCT FROM (p_approval-'evidence') THEN
      RAISE EXCEPTION 'checkout retirement replay conflict' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('status','already_retired','intentId',intent.id,'releasedKobo',0);
  END IF;
  IF clock_timestamp()-(p_approval->'evidence'->>'verifiedAt')::timestamptz NOT BETWEEN interval '0 seconds' AND interval '60 seconds'
    OR p_approval->'evidence'->>'verifiedAt' IS NULL OR intent.phase<>'pending'
    OR intent.session_reference IS NOT NULL OR intent.session_authorization_url IS NOT NULL OR intent.verified_collection IS NOT NULL
    OR intent.initialization_token IS NOT NULL OR intent.initialization_lease_expires_at IS NOT NULL
    OR operation.checkout_retired OR operation.collection_status<>'pending' OR operation.collection_provider_transaction_id IS NOT NULL
    OR operation.transfer_status<>'not_started' OR operation.transfer_attempted_at IS NOT NULL OR operation.transfer_fence<>0
    OR operation.transfer_provider_transaction_id IS NOT NULL OR operation.projection_status<>'unapplied'
    OR operation.collection_attempted_at IS NOT NULL OR operation.collection_fence<>0
    OR operation.verification_lease_expires_at>clock_timestamp()
    OR EXISTS(SELECT 1 FROM prefunded_card.dispatch_queue WHERE operation_id=intent.id AND lease_expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM public.customer_saved_payment_methods WHERE id=intent.prepared_saved_method_id)
    OR EXISTS(SELECT 1 FROM prefunded_card.authorization_bindings WHERE transaction_id=intent.id)
    OR EXISTS(SELECT 1 FROM prefunded_card.provider_aliases WHERE operation_id=intent.id)
    OR EXISTS(SELECT 1 FROM prefunded_card.projections WHERE operation_id=intent.id)
    OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations WHERE id=intent.id OR evidence_id='pvb-card:'||intent.id)
    OR binding.reserved_kobo<intent.amount_kobo THEN
    RAISE EXCEPTION 'checkout retirement state advanced' USING ERRCODE='42501'; END IF;
  INSERT INTO prefunded_card.checkout_retirements(operation_id,intent_id,integration_id,treasury_binding_id,amount_kobo,
    collection_reference,transfer_reference,intent_before_sha256,operation_before_sha256,approval)
    VALUES(intent.id,intent.id,intent.integration_id,intent.treasury_binding_id,intent.amount_kobo,intent.reference,intent.transfer_reference,
      encode(sha256(convert_to(to_jsonb(intent)::text,'UTF8')),'hex'),
      encode(sha256(convert_to(to_jsonb(operation)::text,'UTF8')),'hex'),p_approval);
  UPDATE prefunded_card.operations SET checkout_retired=true WHERE id=intent.id;
  UPDATE prefunded_card.checkout_intents SET phase='retired_unconfirmed' WHERE id=intent.id;
  UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-intent.amount_kobo WHERE id=binding.id;
  UPDATE prefunded_card.dispatch_queue SET finished_at=clock_timestamp(),claim_token=NULL,lease_expires_at=NULL WHERE operation_id=intent.id;
  PERFORM prefunded_card.checkout_validate_scope(scope,true);
  RETURN jsonb_build_object('status','retired_unconfirmed','intentId',intent.id,'releasedKobo',intent.amount_kobo);
END $$;
REVOKE ALL ON FUNCTION prefunded_card.retire_unconfirmed_checkout(jsonb) FROM PUBLIC,anon,authenticated,service_role;
