BEGIN;
CREATE FUNCTION prefunded_card.read_transfer_evidence(p_operation uuid,p_system text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; treasury prefunded_card.treasury_bindings%ROWTYPE;
DECLARE evidence prefunded_card.provider_evidence%ROWTYPE; selected jsonb; scope jsonb;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  IF operation.transfer_status='not_started' OR operation.transfer_attempted_at IS NULL THEN
    RETURN jsonb_build_object('outcome','deferred');
  END IF;
  scope:=prefunded_card.evidence_scope(operation.integration_id,p_system);
  SELECT * INTO STRICT treasury FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id;
  IF treasury.expected_business_id IS DISTINCT FROM scope->>'businessId' THEN
    RETURN jsonb_build_object('outcome','reconciliation_required');
  END IF;
  FOR evidence IN SELECT * FROM prefunded_card.provider_evidence WHERE integration_id=operation.integration_id
    AND (observation->'references') ? operation.transfer_reference LOOP
    IF evidence.conflicted THEN RETURN jsonb_build_object('outcome','reconciliation_required'); END IF;
    IF evidence.observation->>'status'<>'verified' THEN CONTINUE; END IF;
    IF evidence.business_id IS DISTINCT FROM treasury.expected_business_id
      OR evidence.observation->>'destinationWalletId' IS DISTINCT FROM operation.destination_wallet_id
      OR evidence.observation->>'destinationCustomerId' IS DISTINCT FROM operation.destination_customer_id
      OR evidence.observation->>'currency' IS DISTINCT FROM operation.currency
      OR (evidence.observation->>'amountKobo')::bigint IS DISTINCT FROM operation.amount_kobo THEN
      RETURN jsonb_build_object('outcome','reconciliation_required');
    END IF;
    IF evidence.observation->>'kind'='bank_inflow' THEN CONTINUE; END IF;
    IF evidence.observation->>'kind'<>'internal_transfer'
      OR evidence.observation->>'reference' IS DISTINCT FROM operation.transfer_reference
      OR evidence.observation->>'sourceWalletId' IS DISTINCT FROM treasury.source_wallet_id THEN
      RETURN jsonb_build_object('outcome','reconciliation_required');
    END IF;
    IF selected IS NOT NULL AND selected->>'providerTransactionId' IS DISTINCT FROM evidence.observation->>'providerTransactionId' THEN
      RETURN jsonb_build_object('outcome','reconciliation_required');
    END IF;
    selected:=evidence.observation;
  END LOOP;
  IF selected IS NULL THEN RETURN jsonb_build_object('outcome','deferred'); END IF;
  PERFORM mapping.goal_id FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    WHERE mapping.integration_id=operation.integration_id AND mapping.goal_id=operation.goal_id
      AND mapping.merchant_id=operation.merchant_id AND mapping.customer_id=operation.customer_id
      AND mapping.provider_wallet_id=selected->>'destinationWalletId'
      AND mapping.provider_customer_id=selected->>'destinationCustomerId' FOR SHARE OF mapping,customer;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','reconciliation_required'); END IF;
  RETURN jsonb_build_object('outcome','verified_success','request',prefunded_card.request_for_operation(operation),'evidence',jsonb_build_object(
    'reference',selected->>'reference','amountKobo',(selected->>'amountKobo')::bigint,'currency',selected->>'currency',
    'businessId',scope->>'businessId','sourceWalletId',selected->>'sourceWalletId',
    'destinationWalletId',selected->>'destinationWalletId','destinationCustomerId',selected->>'destinationCustomerId',
    'providerTransactionId',selected->>'providerTransactionId'));
END $$;
REVOKE ALL ON FUNCTION prefunded_card.read_transfer_evidence(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
COMMIT;
