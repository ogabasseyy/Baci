BEGIN;
CREATE FUNCTION piggyvest_savings_exit_execution.record_evidence(p_integration uuid, p_receipt jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE saved piggyvest_savings_exit_execution.operations%ROWTYPE;
  existing piggyvest_savings_exit_execution.provider_evidence%ROWTYPE;
  business text; field text;
BEGIN
  IF session_user <> 'piggyvest_exit_evidence_writer' OR inet_client_addr() IS NOT NULL
    OR current_database() <> 'piggyvest_local' OR current_setting('transaction_isolation') <> 'read committed'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = session_user AND NOT rolsuper AND NOT rolbypassrls
      AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = session_user)) THEN
    RAISE EXCEPTION 'exit evidence writer denied' USING ERRCODE = '42501';
  END IF;
  SELECT scope.expected_business_id INTO business FROM piggyvest_savings_exit_execution.evidence_scopes scope
    JOIN piggyvest_staging.integrations registry ON registry.id = scope.integration_id AND registry.enabled
      AND registry.expected_provider_account_id = scope.expected_business_id
    WHERE scope.integration_id = p_integration AND scope.enabled AND scope.authorized_login = session_user FOR SHARE OF scope, registry;
  IF NOT FOUND THEN RAISE EXCEPTION 'exit evidence scope denied' USING ERRCODE = '42501'; END IF;
  IF p_receipt IS NULL OR jsonb_typeof(p_receipt) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_receipt)) <> 11
    OR NOT p_receipt ?& ARRAY['eventId','providerTransactionId','providerCustomerId','reference','sourceWalletId',
      'destinationWalletId','businessId','currency','amountKobo','feeKobo','payloadSha256'] THEN
    RAISE EXCEPTION 'exit evidence invalid' USING ERRCODE = '22023';
  END IF;
  FOREACH field IN ARRAY ARRAY['eventId','providerTransactionId','providerCustomerId','reference','sourceWalletId',
    'destinationWalletId','businessId','currency','payloadSha256'] LOOP
    IF jsonb_typeof(p_receipt->field) <> 'string' OR (p_receipt->>field) !~ '^[A-Za-z0-9_.:-]{1,128}$' THEN
      RAISE EXCEPTION 'exit evidence invalid' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['amountKobo','feeKobo'] LOOP
    IF jsonb_typeof(p_receipt->field) <> 'number' OR (p_receipt->>field)::numeric NOT BETWEEN 0 AND 9007199254740991
      OR trunc((p_receipt->>field)::numeric) <> (p_receipt->>field)::numeric THEN
      RAISE EXCEPTION 'exit evidence invalid' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_receipt->>'businessId' <> business OR p_receipt->>'currency' <> 'NGN'
    OR p_receipt->>'payloadSha256' !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'exit evidence scope mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO saved FROM piggyvest_savings_exit_execution.operations
    WHERE operation_id = (p_receipt->>'reference')::uuid AND integration_id = p_integration FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','deferred'); END IF;
  IF saved.transfer->>'sourceWalletId' <> p_receipt->>'sourceWalletId'
    OR saved.transfer->>'destinationWalletId' <> p_receipt->>'destinationWalletId'
    OR (saved.transfer->>'amountKobo')::numeric <> (p_receipt->>'amountKobo')::numeric
    OR NOT EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings mapping
      WHERE mapping.integration_id = saved.integration_id AND mapping.merchant_id = saved.merchant_id
        AND mapping.customer_id = saved.customer_id AND mapping.goal_id = saved.goal_id
        AND mapping.provider_wallet_id = p_receipt->>'sourceWalletId'
        AND mapping.provider_customer_id = p_receipt->>'providerCustomerId') THEN
    RAISE EXCEPTION 'exit evidence identity mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO existing FROM piggyvest_savings_exit_execution.provider_evidence
    WHERE operation_id = saved.operation_id OR (integration_id = p_integration
      AND (provider_transaction_id = p_receipt->>'providerTransactionId' OR event_id = p_receipt->>'eventId'));
  IF FOUND THEN
    IF existing.operation_id <> saved.operation_id OR existing.integration_id <> p_integration OR existing.receipt <> p_receipt THEN
      RAISE EXCEPTION 'exit evidence replay conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('state','stored');
  END IF;
  IF saved.state <> 'verify' THEN RAISE EXCEPTION 'exit evidence terminal conflict' USING ERRCODE = '23514'; END IF;
  INSERT INTO piggyvest_savings_exit_execution.provider_evidence
    (operation_id,integration_id,provider_transaction_id,event_id,receipt)
    VALUES(saved.operation_id,p_integration,p_receipt->>'providerTransactionId',p_receipt->>'eventId',p_receipt);
  RETURN jsonb_build_object('state','stored');
END $$;
REVOKE ALL ON FUNCTION piggyvest_savings_exit_execution.record_evidence(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_savings_exit_execution.record_evidence(uuid,jsonb) IS
  'Only the independently provisioned local evidence writer may store normalized authenticated provider observations. Customer execution cannot attest finality. Signature and provider reads occur in the server-only adapter, never in the dispatch response.';
COMMIT;
