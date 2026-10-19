BEGIN;

CREATE FUNCTION prefunded_card.checkout_validate_collection(
  intent prefunded_card.checkout_intents,p_collection jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE collection_authorization jsonb;
BEGIN
  IF p_collection IS NULL OR jsonb_typeof(p_collection)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_collection))<>7
    OR NOT p_collection ?& ARRAY['intentId','reference','providerTransactionId','amountKobo','currency','domain','authorization']
    OR jsonb_typeof(p_collection->'intentId')<>'string' OR jsonb_typeof(p_collection->'reference')<>'string'
    OR jsonb_typeof(p_collection->'providerTransactionId')<>'string' OR jsonb_typeof(p_collection->'amountKobo')<>'number'
    OR jsonb_typeof(p_collection->'currency')<>'string' OR jsonb_typeof(p_collection->'domain')<>'string'
    OR jsonb_typeof(p_collection->'authorization')<>'object' THEN
    RAISE EXCEPTION 'first-card checkout collection denied' USING ERRCODE='42501';
  END IF;
  IF p_collection->>'intentId' IS DISTINCT FROM intent.id::text
    OR p_collection->>'reference' IS DISTINCT FROM intent.reference
    OR p_collection->>'currency' IS DISTINCT FROM 'NGN' OR p_collection->>'domain' IS DISTINCT FROM 'test'
    OR p_collection->>'providerTransactionId' !~ '^[1-9][0-9]{0,19}$'
    OR p_collection->>'amountKobo' !~ '^[1-9][0-9]{0,15}$' THEN
    RAISE EXCEPTION 'first-card checkout collection denied' USING ERRCODE='42501';
  END IF;
  IF (p_collection->>'providerTransactionId')::numeric>18446744073709551615
    OR (p_collection->>'amountKobo')::bigint IS DISTINCT FROM intent.amount_kobo THEN
    RAISE EXCEPTION 'first-card checkout collection denied' USING ERRCODE='42501';
  END IF;
  collection_authorization:=p_collection->'authorization';
  IF jsonb_typeof(collection_authorization)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(collection_authorization))<>9
    OR NOT collection_authorization ?& ARRAY['authorizationCode','signature','customerCode','email','reusable','brand','last4','expiryMonth','expiryYear']
    OR jsonb_typeof(collection_authorization->'authorizationCode')<>'string' OR jsonb_typeof(collection_authorization->'signature')<>'string'
    OR jsonb_typeof(collection_authorization->'customerCode')<>'string' OR jsonb_typeof(collection_authorization->'email')<>'string'
    OR jsonb_typeof(collection_authorization->'reusable')<>'boolean' OR jsonb_typeof(collection_authorization->'brand')<>'string'
    OR jsonb_typeof(collection_authorization->'last4')<>'string' OR jsonb_typeof(collection_authorization->'expiryMonth')<>'string'
    OR jsonb_typeof(collection_authorization->'expiryYear')<>'string' THEN
    RAISE EXCEPTION 'first-card checkout authorization denied' USING ERRCODE='42501';
  END IF;
  IF collection_authorization->>'authorizationCode' !~ '^AUTH_[A-Za-z0-9_]+$'
    OR octet_length(collection_authorization->>'authorizationCode') NOT BETWEEN 6 AND 512
    OR octet_length(collection_authorization->>'signature') NOT BETWEEN 1 AND 512 OR collection_authorization->>'signature' ~ '[[:space:][:cntrl:]]'
    OR collection_authorization->>'customerCode' !~ '^CUS_[A-Za-z0-9_]+$' OR octet_length(collection_authorization->>'customerCode')>512
    OR collection_authorization->>'email' IS DISTINCT FROM intent.email OR collection_authorization->'reusable' IS DISTINCT FROM 'true'::jsonb
    OR octet_length(btrim(coalesce(collection_authorization->>'brand',''))) NOT BETWEEN 1 AND 64
    OR collection_authorization->>'brand' ~ '[[:cntrl:]]' OR collection_authorization->>'last4' !~ '^[0-9]{4}$'
    OR collection_authorization->>'expiryMonth' !~ '^(0?[1-9]|1[0-2])$' OR collection_authorization->>'expiryYear' !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'first-card checkout authorization denied' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.checkout_promote_collection(
  p_scope jsonb,p_selection jsonb,p_collection jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE; operation prefunded_card.operations%ROWTYPE;
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE; collection_authorization jsonb;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  intent:=prefunded_card.checkout_lock_intent(p_scope,p_selection,true,false);
  PERFORM prefunded_card.checkout_validate_collection(intent,p_collection);
  SELECT * INTO operation FROM prefunded_card.operations WHERE id=intent.operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'first-card checkout operation denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=intent.treasury_binding_id FOR SHARE;
  IF NOT FOUND OR operation.integration_id IS DISTINCT FROM intent.integration_id
    OR operation.merchant_id IS DISTINCT FROM intent.merchant_id
    OR operation.customer_id IS DISTINCT FROM intent.customer_id OR operation.goal_id IS DISTINCT FROM intent.goal_id
    OR operation.treasury_binding_id IS DISTINCT FROM intent.treasury_binding_id
    OR operation.saved_method_id IS DISTINCT FROM intent.prepared_saved_method_id
    OR operation.amount_kobo IS DISTINCT FROM intent.amount_kobo OR operation.currency IS DISTINCT FROM intent.currency
    OR operation.collection_reference IS DISTINCT FROM intent.reference OR operation.transfer_reference IS DISTINCT FROM intent.transfer_reference
    OR binding.integration_id IS DISTINCT FROM intent.integration_id OR binding.merchant_id IS DISTINCT FROM intent.merchant_id
    OR binding.expected_business_id IS DISTINCT FROM intent.business_id OR binding.authorized_login IS DISTINCT FROM intent.authorized_login THEN
    RAISE EXCEPTION 'first-card checkout operation denied' USING ERRCODE='42501';
  END IF;
  IF intent.phase IN ('funding_pending','completed') THEN
    IF intent.verified_collection IS DISTINCT FROM p_collection THEN
      RAISE EXCEPTION 'first-card checkout collection conflict' USING ERRCODE='23505';
    END IF;
    RETURN prefunded_card.checkout_snapshot(intent);
  END IF;
  IF intent.phase='reconciliation_required' THEN
    RETURN prefunded_card.checkout_snapshot(intent);
  END IF;
  IF intent.phase NOT IN ('initializing','ready','pending') OR operation.collection_status<>'pending'
    OR operation.collection_provider_transaction_id IS NOT NULL OR operation.transfer_status<>'not_started' THEN
    RAISE EXCEPTION 'first-card checkout promotion unavailable' USING ERRCODE='42501';
  END IF;
  collection_authorization:=p_collection->'authorization';
  IF EXISTS (SELECT 1 FROM public.customer_saved_payment_methods method WHERE method.customer_id=intent.customer_id
    AND method.provider='paystack' AND method.authorization_signature=collection_authorization->>'signature' FOR KEY SHARE) THEN
    PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
    UPDATE prefunded_card.checkout_intents SET phase='reconciliation_required',reconciliation_flagged_at=clock_timestamp(),
      reconciliation_flagged_by=session_user WHERE id=intent.id;
    SELECT * INTO intent FROM prefunded_card.checkout_intents WHERE id=intent.id;
    RETURN prefunded_card.checkout_snapshot(intent);
  END IF;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  BEGIN
    INSERT INTO public.customer_saved_payment_methods(id,merchant_id,customer_id,provider,provider_customer_email,
      authorization_code,authorization_signature,authorization_data,brand,last4,exp_month,exp_year,reusable,is_default,is_active)
    VALUES(intent.prepared_saved_method_id,intent.merchant_id,intent.customer_id,'paystack',intent.email,
      collection_authorization->>'authorizationCode',collection_authorization->>'signature',jsonb_build_object('authorization_code',collection_authorization->>'authorizationCode',
        'signature',collection_authorization->>'signature','channel','card','reusable',true),collection_authorization->>'brand',collection_authorization->>'last4',
      collection_authorization->>'expiryMonth',collection_authorization->>'expiryYear',true,false,true);
    INSERT INTO prefunded_card.authorization_bindings(treasury_binding_id,saved_method_id,integration_id,merchant_id,customer_id,
      transaction_id,provider_transaction_id,provider_reference,email,authorization_code,authorization_signature,paystack_customer_code,
      domain,reusable,authorized_login,system_identifier,database_name,provisioned_by)
    VALUES(intent.treasury_binding_id,intent.prepared_saved_method_id,intent.integration_id,intent.merchant_id,intent.customer_id,
      intent.id,p_collection->>'providerTransactionId',intent.reference,intent.email,collection_authorization->>'authorizationCode',
      collection_authorization->>'signature',collection_authorization->>'customerCode','test',true,intent.authorized_login,intent.system_identifier,
      intent.database_name,session_user);
    UPDATE prefunded_card.operations SET collection_status='verified_success',
      collection_provider_transaction_id=p_collection->>'providerTransactionId' WHERE id=operation.id;
    UPDATE prefunded_card.checkout_intents SET phase='funding_pending',verified_collection=p_collection,
      initialization_token=NULL,initialization_lease_expires_at=NULL WHERE id=intent.id;
  EXCEPTION WHEN unique_violation THEN
    PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
    UPDATE prefunded_card.checkout_intents SET phase='reconciliation_required',reconciliation_flagged_at=clock_timestamp(),
      reconciliation_flagged_by=session_user WHERE id=intent.id;
  END;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  SELECT * INTO intent FROM prefunded_card.checkout_intents WHERE id=intent.id;
  RETURN prefunded_card.checkout_snapshot(intent);
END $$;

CREATE FUNCTION prefunded_card.checkout_flag_reconciliation(p_scope jsonb,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  intent:=prefunded_card.checkout_lock_intent(p_scope,p_selection,true,false);
  IF intent.phase IN ('funding_pending','completed','reconciliation_required') THEN RETURN 'true'::jsonb; END IF;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  UPDATE prefunded_card.checkout_intents SET phase='reconciliation_required',initialization_token=NULL,
    initialization_lease_expires_at=NULL,reconciliation_flagged_at=clock_timestamp(),reconciliation_flagged_by=session_user
    WHERE id=intent.id;
  RETURN 'true'::jsonb;
END $$;

REVOKE ALL ON FUNCTION prefunded_card.checkout_validate_collection(prefunded_card.checkout_intents,jsonb),
  prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb),prefunded_card.checkout_flag_reconciliation(jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
