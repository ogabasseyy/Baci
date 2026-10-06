BEGIN;
CREATE FUNCTION prefunded_card.provision_authorization(
  p_treasury uuid,p_integration uuid,p_merchant uuid,p_customer uuid,p_method uuid,p_transaction uuid,p_system text,p_receipt jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate jsonb; stored prefunded_card.authorization_bindings%ROWTYPE; worker name;
BEGIN
  candidate:=prefunded_card.authorization_candidate(p_treasury,p_integration,p_merchant,p_customer,p_method,p_transaction,p_system);
  IF p_receipt IS NULL OR jsonb_typeof(p_receipt)<>'object'
    OR p_receipt->>'status' IS DISTINCT FROM 'success' OR p_receipt->>'domain' IS DISTINCT FROM 'test'
    OR p_receipt->>'currency' IS DISTINCT FROM 'NGN' OR p_receipt->>'channel' IS DISTINCT FROM 'card'
    OR p_receipt->>'reference' IS DISTINCT FROM candidate->>'reference'
    OR p_receipt->'amount' IS DISTINCT FROM candidate->'amountKobo'
    OR p_receipt#>>'{customer,email}' IS DISTINCT FROM candidate->>'email'
    OR p_receipt#>>'{authorization,authorization_code}' IS DISTINCT FROM candidate->>'authorizationCode'
    OR p_receipt#>>'{authorization,signature}' IS DISTINCT FROM candidate->>'signature'
    OR p_receipt#>>'{authorization,channel}' IS DISTINCT FROM 'card'
    OR p_receipt#>'{authorization,reusable}' IS DISTINCT FROM 'true'::jsonb
    OR p_receipt#>>'{metadata,customer_id}' IS DISTINCT FROM candidate->>'customerId'
    OR p_receipt#>>'{metadata,merchant_slug}' IS DISTINCT FROM candidate->>'merchantSlug'
    OR p_receipt#>>'{metadata,transaction_type}' IS DISTINCT FROM 'savings_authorization'
    OR coalesce(p_receipt->>'id','') !~ '^[1-9][0-9]{0,19}$'
    OR (p_receipt->>'id')::numeric>18446744073709551615
    OR coalesce(p_receipt#>>'{customer,customer_code}','') !~ '^CUS_[A-Za-z0-9_]+$'
    OR length(p_receipt#>>'{customer,customer_code}')>512 THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  SELECT authorized_login INTO worker FROM prefunded_card.treasury_bindings WHERE id=p_treasury FOR SHARE;
  INSERT INTO prefunded_card.authorization_bindings(
    treasury_binding_id,saved_method_id,integration_id,merchant_id,customer_id,transaction_id,
    provider_transaction_id,provider_reference,email,authorization_code,authorization_signature,
    paystack_customer_code,domain,reusable,authorized_login,system_identifier,database_name,provisioned_by
  ) VALUES(p_treasury,p_method,p_integration,p_merchant,p_customer,p_transaction,
    p_receipt->>'id',p_receipt->>'reference',p_receipt#>>'{customer,email}',
    p_receipt#>>'{authorization,authorization_code}',p_receipt#>>'{authorization,signature}',
    p_receipt#>>'{customer,customer_code}',p_receipt->>'domain',true,worker,p_system,current_database(),session_user)
    ON CONFLICT (treasury_binding_id,saved_method_id) DO NOTHING;
  IF FOUND THEN
    RETURN jsonb_build_object('savedMethodId',p_method,'transactionId',p_transaction,'outcome','provisioned');
  END IF;
  SELECT * INTO stored FROM prefunded_card.authorization_bindings WHERE treasury_binding_id=p_treasury AND saved_method_id=p_method FOR SHARE;
  IF stored.transaction_id IS DISTINCT FROM p_transaction OR stored.customer_id IS DISTINCT FROM p_customer
    OR stored.merchant_id IS DISTINCT FROM p_merchant OR stored.integration_id IS DISTINCT FROM p_integration
    OR stored.authorization_code IS DISTINCT FROM p_receipt#>>'{authorization,authorization_code}'
    OR stored.authorization_signature IS DISTINCT FROM p_receipt#>>'{authorization,signature}'
    OR stored.paystack_customer_code IS DISTINCT FROM p_receipt#>>'{customer,customer_code}'
    OR stored.email IS DISTINCT FROM p_receipt#>>'{customer,email}'
    OR stored.provider_transaction_id IS DISTINCT FROM p_receipt->>'id'
    OR stored.provider_reference IS DISTINCT FROM p_receipt->>'reference'
    OR stored.system_identifier IS DISTINCT FROM p_system OR stored.database_name IS DISTINCT FROM current_database()
    OR stored.authorized_login IS DISTINCT FROM worker THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('savedMethodId',stored.saved_method_id,'transactionId',stored.transaction_id,'outcome','duplicate');
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
END $$;

CREATE FUNCTION prefunded_card.read_authorization(
  p_treasury uuid,p_integration uuid,p_merchant uuid,p_customer uuid,p_method uuid,p_system text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stored prefunded_card.authorization_bindings%ROWTYPE; method public.customer_saved_payment_methods%ROWTYPE;
DECLARE eligible boolean; reusable boolean;
BEGIN
  PERFORM prefunded_card.authorization_scope(p_treasury,p_integration,p_merchant,p_system,false);
  SELECT * INTO stored FROM prefunded_card.authorization_bindings WHERE treasury_binding_id=p_treasury
    AND integration_id=p_integration AND merchant_id=p_merchant AND customer_id=p_customer AND saved_method_id=p_method
    AND authorized_login=session_user AND system_identifier=p_system AND database_name=current_database() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO method FROM public.customer_saved_payment_methods WHERE id=stored.saved_method_id FOR SHARE;
  eligible:=FOUND AND method.merchant_id=stored.merchant_id AND method.customer_id=stored.customer_id
    AND method.provider='paystack' AND method.provider_customer_email=stored.email
    AND method.authorization_code=stored.authorization_code AND method.authorization_signature=stored.authorization_signature
    AND method.authorization_data->>'authorization_code'=stored.authorization_code
    AND method.authorization_data->>'signature'=stored.authorization_signature
    AND method.authorization_data->>'channel'='card' AND method.authorization_data->'reusable'='true'::jsonb
    AND method.is_active AND method.disabled_at IS NULL;
  PERFORM id FROM public.customers WHERE id=stored.customer_id AND merchant_id=stored.merchant_id FOR SHARE;
  eligible:=eligible AND FOUND;
  reusable:=coalesce(method.reusable,false) AND stored.reusable;
  RETURN jsonb_build_object('savedMethodId',stored.saved_method_id,'merchantId',stored.merchant_id,
    'customerId',stored.customer_id,'email',stored.email,'authorizationCode',stored.authorization_code,
    'paystackCustomerCode',stored.paystack_customer_code,'domain',stored.domain,
    'reusable',reusable,'active',coalesce(eligible,false));
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb),
  prefunded_card.read_authorization(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
