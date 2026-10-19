DO $postflight$
DECLARE approval jsonb; intent prefunded_card.checkout_intents%ROWTYPE;
DECLARE collection_authorization jsonb; method jsonb; binding jsonb;
BEGIN
  SELECT value INTO STRICT approval FROM pg_temp.reviewed_approval;
  SELECT * INTO STRICT intent FROM prefunded_card.checkout_intents WHERE id='ff561046-58e7-428d-9163-f6e60b0dab65';
  collection_authorization:=approval#>'{collection,authorization}';
  IF session_user<>'postgres' OR current_user<>'postgres'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz
    OR clock_timestamp()-(approval#>>'{proof,verifiedAt}')::timestamptz>interval '60 seconds'
    OR pg_temp.reviewed_metadata() IS DISTINCT FROM approval#>>'{preflight,permanentMetadataSha256}'
    OR pg_temp.reviewed_state() IS DISTINCT FROM approval#>>'{preflight,protectedRowsSha256}'
    OR intent.phase<>'funding_pending' OR intent.verified_collection IS DISTINCT FROM approval->'collection'
    OR NOT EXISTS(SELECT 1 FROM prefunded_card.operations WHERE id=intent.id
      AND collection_status='verified_success' AND collection_provider_transaction_id=approval#>>'{collection,providerTransactionId}'
      AND transfer_status='not_started' AND projection_status='unapplied')
    OR (SELECT count(*) FROM public.customer_saved_payment_methods WHERE id=intent.prepared_saved_method_id)<>1
    OR (SELECT count(*) FROM prefunded_card.authorization_bindings WHERE transaction_id=intent.id)<>1 THEN
    RAISE EXCEPTION 'reviewed postflight preservation refused' USING ERRCODE='42501';
  END IF;
  SELECT to_jsonb(entry) INTO STRICT method FROM public.customer_saved_payment_methods entry WHERE id=intent.prepared_saved_method_id;
  SELECT to_jsonb(entry) INTO STRICT binding FROM prefunded_card.authorization_bindings entry WHERE transaction_id=intent.id;
  IF NOT method @> jsonb_build_object('id',intent.prepared_saved_method_id,'merchant_id',intent.merchant_id,
    'customer_id',intent.customer_id,'provider','paystack','provider_customer_email',intent.email,
    'authorization_code',collection_authorization->>'authorizationCode','authorization_signature',collection_authorization->>'signature',
    'authorization_data',jsonb_build_object('authorization_code',collection_authorization->>'authorizationCode',
      'signature',collection_authorization->>'signature','channel','card','reusable',true),
    'brand',collection_authorization->>'brand','last4',collection_authorization->>'last4','exp_month',collection_authorization->>'expiryMonth',
    'exp_year',collection_authorization->>'expiryYear','reusable',true,'is_default',false,'is_active',true)
    OR NOT binding @> jsonb_build_object('treasury_binding_id',intent.treasury_binding_id,
      'saved_method_id',intent.prepared_saved_method_id,'integration_id',intent.integration_id,
      'merchant_id',intent.merchant_id,'customer_id',intent.customer_id,'transaction_id',intent.id,
      'provider_transaction_id',approval#>>'{collection,providerTransactionId}','provider_reference',intent.reference,
      'email',intent.email,'authorization_code',collection_authorization->>'authorizationCode',
      'authorization_signature',collection_authorization->>'signature','paystack_customer_code',collection_authorization->>'customerCode',
      'domain','test','reusable',true,'authorized_login',intent.authorized_login,
      'system_identifier',intent.system_identifier,'database_name',intent.database_name,'provisioned_by','prefunded_authorizer') THEN
    RAISE EXCEPTION 'reviewed saved authorization mismatch' USING ERRCODE='42501';
  END IF;
END $postflight$;
