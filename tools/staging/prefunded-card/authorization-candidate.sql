BEGIN;
CREATE FUNCTION prefunded_card.authorization_scope(
  p_treasury uuid,p_integration uuid,p_merchant uuid,p_system text,p_provision boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE required_role oid; binding prefunded_card.treasury_bindings%ROWTYPE;
BEGIN
  SELECT oid INTO required_role FROM pg_roles WHERE rolname=CASE WHEN p_provision
    THEN 'prefunded_card_authorization_provisioner' ELSE 'prefunded_card_authorization_reader' END;
  IF required_role IS NULL OR NOT pg_has_role(session_user,required_role,'MEMBER')
    OR session_user IN ('anon','authenticated','service_role')
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND NOT rolsuper AND NOT rolbypassrls)
    OR p_system IS NULL OR p_system !~ '^[0-9]{1,20}$'
    OR p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system()) THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings
    WHERE id=p_treasury AND integration_id=p_integration AND merchant_id=p_merchant FOR SHARE;
  IF NOT FOUND OR (NOT p_provision AND binding.authorized_login<>session_user) THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  IF p_provision THEN
    PERFORM registry.id FROM piggyvest_staging.integrations registry WHERE registry.id=binding.integration_id
      AND registry.enabled AND registry.expected_provider_account_id=binding.expected_business_id FOR SHARE;
    IF NOT FOUND OR NOT binding.enabled THEN
      RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
    END IF;
  END IF;
END $$;

CREATE FUNCTION prefunded_card.authorization_candidate(
  p_treasury uuid,p_integration uuid,p_merchant uuid,p_customer uuid,p_method uuid,p_transaction uuid,p_system text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE method public.customer_saved_payment_methods%ROWTYPE; payment public.transactions%ROWTYPE;
DECLARE merchant_slug text; amount_kobo numeric;
BEGIN
  PERFORM prefunded_card.authorization_scope(p_treasury,p_integration,p_merchant,p_system,true);
  PERFORM id FROM public.customers WHERE id=p_customer AND merchant_id=p_merchant FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501'; END IF;
  SELECT slug INTO merchant_slug FROM public.merchants WHERE id=p_merchant FOR SHARE;
  SELECT * INTO method FROM public.customer_saved_payment_methods WHERE id=p_method
    AND merchant_id=p_merchant AND customer_id=p_customer AND provider='paystack'
    AND is_active AND reusable AND disabled_at IS NULL FOR SHARE;
  IF NOT FOUND OR method.authorization_code !~ '^AUTH_[A-Za-z0-9_]+$'
    OR length(method.authorization_code) NOT BETWEEN 6 AND 512
    OR length(method.authorization_signature) NOT BETWEEN 1 AND 512
    OR method.authorization_signature ~ '[[:space:][:cntrl:]]'
    OR method.authorization_data->>'authorization_code' IS DISTINCT FROM method.authorization_code
    OR method.authorization_data->>'signature' IS DISTINCT FROM method.authorization_signature
    OR method.authorization_data->'reusable' IS DISTINCT FROM 'true'::jsonb
    OR method.authorization_data->>'channel' IS DISTINCT FROM 'card' THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO payment FROM public.transactions WHERE id=p_transaction
    AND merchant_id=p_merchant AND gateway='paystack' AND transaction_type='payment'
    AND status='completed' AND currency='NGN' FOR SHARE;
  IF NOT FOUND OR payment.metadata->>'customer_id' IS DISTINCT FROM p_customer::text
    OR payment.metadata->>'customer_email' IS DISTINCT FROM method.provider_customer_email
    OR payment.metadata->>'merchant_slug' IS DISTINCT FROM merchant_slug
    OR payment.metadata->>'transaction_type' IS DISTINCT FROM 'savings_authorization'
    OR payment.gateway_reference IS NULL OR payment.gateway_reference !~ '^[A-Za-z0-9.=-]+$'
    OR length(payment.gateway_reference) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  amount_kobo:=payment.amount*100;
  IF amount_kobo IS NULL OR amount_kobo NOT BETWEEN 1 AND 9007199254740991 OR trunc(amount_kobo)<>amount_kobo THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('savedMethodId',method.id,'merchantId',method.merchant_id,
    'customerId',method.customer_id,'transactionId',payment.id,'email',method.provider_customer_email,
    'authorizationCode',method.authorization_code,'signature',method.authorization_signature,
    'reference',payment.gateway_reference,'amountKobo',amount_kobo,'merchantSlug',merchant_slug);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.authorization_scope(uuid,uuid,uuid,text,boolean),
  prefunded_card.authorization_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
