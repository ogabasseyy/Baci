BEGIN;
CREATE FUNCTION prefunded_card.resolve_replay_enrollment(
  p_integration uuid,p_merchant uuid,p_treasury uuid,p_business text,
  p_database text,p_system text,p_hints jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE treasury record;
DECLARE mapped record;
DECLARE operation record;
DECLARE bank boolean; reference_values text[]; matched uuid[];
DECLARE destination_wallet text; destination_customer text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
    OR p_database IS DISTINCT FROM current_database()
    OR p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
    OR p_business IS NULL OR octet_length(p_business) NOT BETWEEN 1 AND 512
    OR jsonb_typeof(p_hints) IS DISTINCT FROM 'object'
    OR octet_length(p_hints::text)>16384 THEN RETURN 'deferred'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_hints))<>8
    OR NOT p_hints ?& ARRAY['eventType','envelopeWalletId','envelopeCustomerId',
      'destinationWalletId','innerCustomerId','sourceWalletId','declaredDestinationWalletId','references']
    OR EXISTS(SELECT 1 FROM jsonb_each(p_hints) field
      WHERE field.key NOT IN ('references','sourceWalletId','declaredDestinationWalletId','destinationWalletId','innerCustomerId')
        AND (jsonb_typeof(field.value)<>'string' OR octet_length(field.value#>>'{}') NOT BETWEEN 1 AND 512
          OR (field.value#>>'{}')~'[[:space:][:cntrl:]]'))
    OR EXISTS(SELECT 1 FROM jsonb_each(p_hints) field
      WHERE field.key IN ('sourceWalletId','declaredDestinationWalletId','destinationWalletId','innerCustomerId') AND field.value<>'null'::jsonb
        AND (jsonb_typeof(field.value)<>'string' OR octet_length(field.value#>>'{}') NOT BETWEEN 1 AND 512
          OR (field.value#>>'{}')~'[[:space:][:cntrl:]]'))
    OR jsonb_typeof(p_hints->'references') IS DISTINCT FROM 'array' THEN RETURN 'deferred'; END IF;
  IF jsonb_array_length(p_hints->'references') NOT BETWEEN 1 AND 16
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_hints->'references') reference_value
      WHERE jsonb_typeof(reference_value)<>'string' OR octet_length(reference_value#>>'{}') NOT BETWEEN 1 AND 512
        OR (reference_value#>>'{}')~'[[:space:][:cntrl:]]')
    OR p_hints->>'eventType' NOT IN ('bank-transfer.inflow.success','wallet-transfer.outflow.success')
    OR (p_hints->>'innerCustomerId' IS NOT NULL
      AND p_hints->>'innerCustomerId' IS DISTINCT FROM p_hints->>'envelopeCustomerId')
    OR (p_hints->>'declaredDestinationWalletId' IS NOT NULL AND p_hints->>'destinationWalletId' IS NOT NULL
      AND p_hints->>'declaredDestinationWalletId' IS DISTINCT FROM p_hints->>'destinationWalletId'
      AND (p_hints->>'eventType'<>'bank-transfer.inflow.success'
        OR p_hints->>'declaredDestinationWalletId' IS DISTINCT FROM p_hints->>'envelopeWalletId'))
    THEN RETURN 'deferred'; END IF;
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_ledger_worker');
  PERFORM id FROM piggyvest_staging.integrations WHERE id=p_integration AND enabled
    AND expected_provider_account_id=p_business FOR SHARE;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  PERFORM prefunded_card.evidence_scope(p_integration,p_system);
  PERFORM integration_id FROM prefunded_card.evidence_authorities
    WHERE integration_id=p_integration AND reader_login=session_user AND enabled
      AND business_id=p_business AND system_identifier=p_system AND currency='NGN' FOR SHARE;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  SELECT binding.* INTO STRICT treasury FROM prefunded_card.treasury_bindings binding
    JOIN prefunded_card.treasury_identities identity ON identity.treasury_binding_id=binding.id
      AND identity.integration_id=binding.integration_id AND identity.merchant_id=binding.merchant_id
      AND identity.authorized_login=binding.authorized_login
      AND identity.expected_business_id=binding.expected_business_id
      AND identity.source_wallet_id=binding.source_wallet_id
    WHERE binding.id=p_treasury AND binding.integration_id=p_integration AND binding.merchant_id=p_merchant
      AND binding.expected_business_id=p_business AND binding.authorized_login=session_user
      AND binding.enabled AND binding.currency='NGN' FOR SHARE OF binding,identity;
  bank:=p_hints->>'eventType'='bank-transfer.inflow.success';
  SELECT array_agg(value) INTO reference_values FROM jsonb_array_elements_text(p_hints->'references');
  SELECT coalesce(array_agg(candidate.id),'{}'::uuid[]) INTO matched FROM (
    SELECT entry.id FROM prefunded_card.operations entry WHERE entry.integration_id=p_integration
      AND (entry.transfer_reference=ANY(reference_values) OR entry.collection_reference=ANY(reference_values)
        OR entry.transfer_provider_transaction_id=ANY(reference_values)
        OR entry.collection_provider_transaction_id=ANY(reference_values)
        OR EXISTS(SELECT 1 FROM prefunded_card.provider_aliases alias
          WHERE alias.integration_id=p_integration AND alias.operation_id=entry.id
            AND alias.provider_transaction_id=ANY(reference_values))) LIMIT 2
  ) candidate;
  IF cardinality(matched)>1 THEN RETURN 'deferred'; END IF;
  IF cardinality(matched)=1 THEN
    SELECT * INTO STRICT operation FROM prefunded_card.operations WHERE id=matched[1] FOR SHARE;
    IF operation.merchant_id<>p_merchant OR operation.treasury_binding_id<>p_treasury THEN RETURN 'deferred'; END IF;
  ELSIF NOT bank THEN RETURN 'deferred';
  ELSIF (SELECT count(*) FROM prefunded_card.treasury_bindings WHERE integration_id=p_integration
    AND merchant_id=p_merchant AND authorized_login=session_user)<>1 THEN RETURN 'deferred'; END IF;
  destination_wallet:=p_hints->>'destinationWalletId';
  IF bank THEN
    IF destination_wallet IS NULL OR p_hints->>'innerCustomerId' IS NULL THEN RETURN 'deferred'; END IF;
  ELSE
    IF p_hints->>'envelopeWalletId' IS DISTINCT FROM treasury.source_wallet_id
      OR (p_hints->>'sourceWalletId' IS NOT NULL AND p_hints->>'sourceWalletId' IS DISTINCT FROM treasury.source_wallet_id)
      OR (destination_wallet IS NOT NULL AND destination_wallet<>operation.destination_wallet_id)
      OR (p_hints->>'declaredDestinationWalletId' IS NOT NULL
        AND p_hints->>'declaredDestinationWalletId'<>operation.destination_wallet_id) THEN RETURN 'deferred'; END IF;
    destination_wallet:=operation.destination_wallet_id;
  END IF;
  IF destination_wallet=treasury.source_wallet_id THEN RETURN 'deferred'; END IF;
  SELECT mapping.* INTO STRICT mapped FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    JOIN public.customer_savings_goals goal ON goal.id=mapping.goal_id
      AND goal.customer_id=mapping.customer_id AND goal.merchant_id=mapping.merchant_id
    WHERE mapping.integration_id=p_integration
      AND ((bank AND mapping.provider_wallet_id=ANY(ARRAY[destination_wallet,p_hints->>'envelopeWalletId']))
        OR (NOT bank AND mapping.provider_wallet_id=destination_wallet)) FOR SHARE OF mapping,customer,goal;
  IF mapped.merchant_id<>p_merchant THEN RETURN 'deferred'; END IF;
  destination_wallet:=mapped.provider_wallet_id;
  destination_customer:=mapped.provider_customer_id;
  IF bank THEN
    IF destination_customer IS DISTINCT FROM p_hints->>'envelopeCustomerId' THEN RETURN 'deferred'; END IF;
  END IF;
  IF cardinality(matched)=1 THEN
    IF operation.merchant_id<>p_merchant OR operation.treasury_binding_id<>p_treasury
      OR operation.goal_id<>mapped.goal_id OR operation.customer_id<>mapped.customer_id
      OR operation.destination_wallet_id<>destination_wallet
      OR operation.destination_customer_id<>destination_customer THEN RETURN 'deferred'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.credit_routes WHERE goal_id=mapped.goal_id) THEN
    PERFORM route.goal_id FROM prefunded_card.credit_routes route
      JOIN piggyvest_savings_ledger.bindings binding ON binding.goal_id=route.goal_id
        AND binding.integration_id=route.integration_id AND binding.merchant_id=route.merchant_id
        AND binding.customer_id=route.customer_id AND binding.enabled AND binding.authorized_login=session_user
      WHERE route.goal_id=mapped.goal_id AND route.integration_id=p_integration AND route.merchant_id=p_merchant
        AND route.customer_id=mapped.customer_id AND route.system_identifier=p_system FOR SHARE OF route,binding;
    IF FOUND THEN RETURN 'enrolled'; END IF;
    RETURN 'deferred';
  END IF;
  IF NOT bank OR cardinality(matched)>0
    OR p_hints->>'envelopeWalletId' IS DISTINCT FROM destination_wallet
    OR p_hints->>'destinationWalletId' IS DISTINCT FROM destination_wallet
    OR p_hints->>'sourceWalletId' IS NOT NULL
    OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.bindings WHERE goal_id=mapped.goal_id)
    OR EXISTS(SELECT 1 FROM prefunded_card.operations WHERE goal_id=mapped.goal_id)
    OR EXISTS(SELECT 1 FROM piggyvest_staging.wallet_goal_mappings other
      WHERE other.provider_wallet_id=destination_wallet AND other.integration_id<>p_integration)
    THEN RETURN 'deferred'; END IF;
  PERFORM goal.id FROM public.customer_savings_goals goal WHERE goal.id=mapped.goal_id
    AND goal.goal_kind='legacy' AND goal.source_mode='manual' AND goal.status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  IF (SELECT count(*) FROM public.piggyvest_plan_wallets WHERE wallet_id=destination_wallet)<>1 THEN RETURN 'deferred'; END IF;
  PERFORM wallet_id FROM public.piggyvest_plan_wallets WHERE wallet_id=destination_wallet
    AND piggyvest_customer_id=destination_customer AND customer_id::text=mapped.customer_id::text
    AND merchant_id::text=p_merchant::text FOR SHARE;
  IF FOUND THEN RETURN 'legacy'; END IF;
  RETURN 'deferred';
EXCEPTION WHEN OTHERS THEN RETURN 'deferred';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
COMMENT ON FUNCTION prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb) IS
  'Read-only routing from bounded untrusted receipt hints and immutable scope/mappings, not signature or monetary evidence. Enrolled only enables subsequent signature retrieval and independent evidence replay. Legacy needs exact private integration and public legacy wallet ownership without a canonical binding. Unknown or ambiguous state defers. Downstream writers must recheck enrollment; this lookup is not credit authority.';
COMMIT;
