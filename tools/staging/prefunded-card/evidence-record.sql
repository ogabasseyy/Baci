BEGIN;
CREATE FUNCTION prefunded_card.record_provider_evidence(p_integration uuid,p_system text,p_observation jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE scope jsonb; stored prefunded_card.provider_evidence%ROWTYPE; expected_keys text[];
BEGIN
  scope:=prefunded_card.evidence_scope(p_integration,p_system);
  PERFORM integration_id FROM prefunded_card.evidence_authorities
    WHERE integration_id=p_integration AND ingestion_login=session_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider evidence ingestion refused' USING ERRCODE='42501'; END IF;
  expected_keys:=ARRAY['eventId','fingerprint','eventType','eventCategory','status','kind','providerTransactionId',
    'destinationCustomerId','sourceWalletId','destinationWalletId','reference','references','amountKobo','feeKobo','currency',
    'eventDataId','envelopeWalletId','sessionId','creditedAt'];
  IF p_observation IS NULL OR jsonb_typeof(p_observation)<>'object' OR NOT p_observation ?& expected_keys
    OR p_observation-expected_keys<>'{}'::jsonb
    OR coalesce(p_observation->>'status','') NOT IN ('deferred','verified')
    OR coalesce(p_observation->>'kind','') NOT IN ('unknown','bank_inflow','internal_transfer')
    OR coalesce(p_observation->>'fingerprint','') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_observation->'references') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid provider evidence' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_observation) field WHERE field.key=ANY(ARRAY[
    'eventId','eventType','eventCategory','destinationCustomerId']) AND
    (jsonb_typeof(field.value)<>'string' OR octet_length(field.value#>>'{}') NOT BETWEEN 1 AND 512))
    OR jsonb_array_length(p_observation->'references')>24
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_observation->'references') reference WHERE
      jsonb_typeof(reference)<>'string' OR octet_length(reference#>>'{}') NOT BETWEEN 1 AND 512) THEN
    RAISE EXCEPTION 'invalid provider evidence identity' USING ERRCODE='22023';
  END IF;
  PERFORM id FROM prefunded_card.treasury_bindings WHERE integration_id=p_integration ORDER BY id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('prefunded-evidence:'||p_integration,0));
  INSERT INTO prefunded_card.provider_evidence(integration_id,event_id,fingerprint,observation,business_id,ingestion_login)
    VALUES(p_integration,p_observation->>'eventId',p_observation->>'fingerprint',
      p_observation||jsonb_build_object('status','deferred'),scope->>'businessId',session_user) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT stored FROM prefunded_card.provider_evidence WHERE integration_id=p_integration
    AND event_id=p_observation->>'eventId' FOR UPDATE;
  IF stored.fingerprint IS DISTINCT FROM p_observation->>'fingerprint' OR stored.conflicted THEN
    UPDATE prefunded_card.provider_evidence SET conflicted=true WHERE integration_id=p_integration AND event_id=stored.event_id;
    PERFORM prefunded_card.fence_provider_evidence_conflict(p_integration,stored.event_id,
      coalesce(stored.observation->'references','[]')||(p_observation->'references'));
    RETURN 'conflict';
  END IF;
  IF p_observation->>'status'='deferred' THEN
    RETURN CASE WHEN stored.observation->>'status'='verified' THEN 'duplicate' ELSE 'stored' END;
  END IF;
  IF NOT prefunded_card.valid_terminal_evidence(p_observation) OR p_observation->>'currency' IS DISTINCT FROM scope->>'currency'
    OR p_observation->'feeKobo' IS DISTINCT FROM '0'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_each(p_observation) field WHERE field.key=ANY(ARRAY[
      'providerTransactionId','destinationWalletId','reference']) AND
      (jsonb_typeof(field.value)<>'string' OR octet_length(field.value#>>'{}') NOT BETWEEN 1 AND 512))
    OR jsonb_typeof(p_observation->'sourceWalletId') IS DISTINCT FROM 'string'
    OR NOT (p_observation->'references') ? (p_observation->>'reference')
    OR NOT (p_observation->'references') ? (p_observation->>'providerTransactionId') THEN RETURN 'deferred'; END IF;
  IF p_observation->>'kind'='bank_inflow' THEN
    IF p_observation->>'eventType'<>'bank-transfer.inflow.success' OR p_observation->>'eventCategory' NOT IN ('bank-transfer','inflow_transaction')
      OR p_observation->>'sourceWalletId'<>'' THEN RETURN 'deferred'; END IF;
  ELSIF p_observation->>'kind'='internal_transfer' THEN
    IF p_observation->>'eventType'<>'wallet-transfer.outflow.success' OR p_observation->>'eventCategory'<>'wallet-transfer'
      OR coalesce(p_observation->>'sourceWalletId','')='' OR p_observation->>'sourceWalletId'=p_observation->>'destinationWalletId'
      THEN RETURN 'deferred'; END IF;
  ELSE RETURN 'deferred'; END IF;
  PERFORM mapping.goal_id FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    JOIN prefunded_card.credit_routes route ON route.goal_id=mapping.goal_id AND route.integration_id=mapping.integration_id
      AND route.merchant_id=mapping.merchant_id AND route.customer_id=mapping.customer_id AND route.system_identifier=p_system
    WHERE mapping.integration_id=p_integration AND mapping.provider_wallet_id=p_observation->>'destinationWalletId'
      AND mapping.provider_customer_id=p_observation->>'destinationCustomerId' FOR SHARE OF mapping,customer,route;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  IF stored.observation->>'status'='verified' THEN
    IF stored.observation=p_observation THEN RETURN 'duplicate'; END IF;
    UPDATE prefunded_card.provider_evidence SET conflicted=true WHERE integration_id=p_integration AND event_id=stored.event_id;
    PERFORM prefunded_card.fence_provider_evidence_conflict(p_integration,stored.event_id,
      coalesce(stored.observation->'references','[]')||(p_observation->'references'));
    RETURN 'conflict';
  END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.provider_evidence other WHERE other.integration_id=p_integration
    AND other.observation->>'status'='verified' AND other.observation->>'providerTransactionId'=p_observation->>'providerTransactionId'
    AND other.observation-ARRAY['eventId','fingerprint','references','eventDataId','creditedAt']
      IS DISTINCT FROM p_observation-ARRAY['eventId','fingerprint','references','eventDataId','creditedAt']) THEN
    UPDATE prefunded_card.provider_evidence SET conflicted=true WHERE integration_id=p_integration
      AND (event_id=stored.event_id OR observation->>'providerTransactionId'=p_observation->>'providerTransactionId');
    PERFORM prefunded_card.fence_provider_evidence_conflict(p_integration,stored.event_id,
      (SELECT coalesce(jsonb_agg(reference),'[]') FROM prefunded_card.provider_evidence receipt,
        LATERAL jsonb_array_elements(receipt.observation->'references') reference WHERE receipt.integration_id=p_integration
        AND (receipt.event_id=stored.event_id OR receipt.observation->>'providerTransactionId'=p_observation->>'providerTransactionId'))
        ||(p_observation->'references'));
    RETURN 'conflict';
  END IF;
  UPDATE prefunded_card.provider_evidence SET observation=p_observation
    WHERE integration_id=p_integration AND event_id=stored.event_id;
  RETURN 'stored';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.record_provider_evidence(uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
COMMIT;
