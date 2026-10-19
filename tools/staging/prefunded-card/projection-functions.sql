BEGIN;
CREATE FUNCTION prefunded_card.read_operation(p_operation uuid,p_system text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  RETURN jsonb_build_object('operationId',operation.id,'collectionStatus',operation.collection_status,
    'transferStatus',operation.transfer_status,'projectionStatus',operation.projection_status,
    'collectionFence',operation.collection_fence,'transferFence',operation.transfer_fence);
END $$;

CREATE FUNCTION prefunded_card.link_inflow(p_operation uuid,p_system text,p_evidence jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE; existing uuid;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  SELECT * INTO STRICT binding FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id;
  IF operation.collection_status<>'verified_success' OR operation.transfer_status<>'verified_success'
    OR NOT prefunded_card.valid_terminal_evidence(p_evidence) THEN RETURN 'deferred'; END IF;
  IF p_evidence->>'reference' IS DISTINCT FROM operation.transfer_reference
    OR p_evidence->>'currency' IS DISTINCT FROM operation.currency
    OR (p_evidence->>'amountKobo')::bigint IS DISTINCT FROM operation.amount_kobo
    OR p_evidence->>'businessId' IS DISTINCT FROM binding.expected_business_id
    OR p_evidence->>'sourceWalletId' IS DISTINCT FROM binding.source_wallet_id
    OR p_evidence->>'destinationWalletId' IS DISTINCT FROM operation.destination_wallet_id
    OR p_evidence->>'destinationCustomerId' IS DISTINCT FROM operation.destination_customer_id
    OR nullif(p_evidence->>'providerTransactionId','') IS NULL
    OR length(p_evidence->>'providerTransactionId')>512 THEN RETURN 'conflict'; END IF;
  INSERT INTO prefunded_card.provider_aliases(integration_id,provider_transaction_id,operation_id)
    VALUES(operation.integration_id,p_evidence->>'providerTransactionId',operation.id) ON CONFLICT DO NOTHING;
  SELECT operation_id INTO existing FROM prefunded_card.provider_aliases
    WHERE integration_id=operation.integration_id AND provider_transaction_id=p_evidence->>'providerTransactionId';
  IF existing IS DISTINCT FROM operation.id THEN RAISE EXCEPTION 'prefunded alias conflict' USING ERRCODE='23505'; END IF;
  RETURN 'linked';
END $$;

CREATE FUNCTION prefunded_card.project(p_operation uuid,p_system text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE;
DECLARE goal public.customer_savings_goals%ROWTYPE; recorded jsonb; contribution uuid:=gen_random_uuid();
DECLARE next_amount numeric; alias_operation uuid; canonical_principal numeric;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  IF operation.projection_status='reconciliation_required' THEN RETURN 'deferred'; END IF;
  IF operation.collection_status<>'verified_success' OR operation.transfer_status<>'verified_success'
    OR nullif(operation.collection_provider_transaction_id,'') IS NULL
    OR nullif(operation.transfer_provider_transaction_id,'') IS NULL THEN RETURN 'deferred'; END IF;
  SELECT * INTO STRICT binding FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id;
  PERFORM mapping.goal_id FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    WHERE mapping.integration_id=operation.integration_id AND mapping.merchant_id=operation.merchant_id
      AND mapping.customer_id=operation.customer_id AND mapping.goal_id=operation.goal_id
      AND mapping.provider_wallet_id=operation.destination_wallet_id
      AND mapping.provider_customer_id=operation.destination_customer_id FOR SHARE OF mapping,customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded projection ownership refused' USING ERRCODE='42501'; END IF;
  PERFORM id FROM piggyvest_staging.integrations WHERE id=operation.integration_id AND enabled
    AND expected_provider_account_id=binding.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded projection integration refused' USING ERRCODE='42501'; END IF;
  SELECT * INTO goal FROM public.customer_savings_goals WHERE id=operation.goal_id
    AND merchant_id=operation.merchant_id AND customer_id=operation.customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded projection goal refused' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.projections WHERE operation_id=operation.id) THEN RETURN 'duplicate'; END IF;
  IF goal.status<>'active' OR goal.completed_at IS NOT NULL OR goal.cancelled_at IS NOT NULL OR goal.spent_at IS NOT NULL THEN
    RETURN 'deferred';
  END IF;
  SELECT coalesce(sum(posting.amount_kobo),0) INTO canonical_principal FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations entry ON entry.id=posting.operation_id
    WHERE entry.goal_id=operation.goal_id AND entry.integration_id=operation.integration_id AND posting.account='principal';
  IF canonical_principal IS DISTINCT FROM goal.current_amount*100 THEN
    RAISE EXCEPTION 'prefunded projection requires reconciled principal' USING ERRCODE='23514';
  END IF;
  next_amount:=goal.current_amount+operation.amount_kobo::numeric/100;
  IF next_amount>goal.target_amount THEN RETURN 'deferred'; END IF;
  INSERT INTO prefunded_card.provider_aliases(integration_id,provider_transaction_id,operation_id)
    VALUES(operation.integration_id,operation.transfer_provider_transaction_id,operation.id) ON CONFLICT DO NOTHING;
  SELECT operation_id INTO alias_operation FROM prefunded_card.provider_aliases WHERE integration_id=operation.integration_id
    AND provider_transaction_id=operation.transfer_provider_transaction_id;
  IF alias_operation IS DISTINCT FROM operation.id THEN RAISE EXCEPTION 'prefunded projection alias conflict' USING ERRCODE='23505'; END IF;
  recorded:=piggyvest_savings_ledger.apply(operation.integration_id,operation.merchant_id,operation.customer_id,operation.goal_id,
    jsonb_build_object('operationId',operation.id,'kind','credit_principal','principalKobo',operation.amount_kobo,
      'interestKobo',0,'evidenceId','pvb-card:'||operation.id,'referenceId',NULL));
  IF recorded->>'outcome' IS DISTINCT FROM 'recorded' OR recorded->>'operationId' IS DISTINCT FROM operation.id::text THEN
    RAISE EXCEPTION 'prefunded canonical acknowledgement refused';
  END IF;
  INSERT INTO prefunded_card.projections(operation_id,contribution_id,ledger_operation_id,amount_kobo)
    VALUES(operation.id,contribution,operation.id,operation.amount_kobo);
  INSERT INTO public.customer_savings_contributions(id,goal_id,merchant_id,customer_id,amount,source_type,status,processed_at,idempotency_key,metadata)
    VALUES(contribution,operation.goal_id,operation.merchant_id,operation.customer_id,operation.amount_kobo::numeric/100,
      'paystack_authorization','completed',clock_timestamp(),'pvb-card:'||operation.id,
      jsonb_build_object('funding_model','prefunded_piggyvest','operation_id',operation.id,
        'transfer_reference',operation.transfer_reference,'provider_transaction_id',operation.transfer_provider_transaction_id));
  UPDATE public.customer_savings_goals SET current_amount=next_amount,
    status=CASE WHEN next_amount=target_amount THEN 'completed' ELSE 'active' END,
    completed_at=CASE WHEN next_amount=target_amount THEN clock_timestamp() ELSE completed_at END,
    updated_at=clock_timestamp() WHERE id=operation.goal_id;
  UPDATE prefunded_card.operations SET projection_status='applied' WHERE id=operation.id;
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.project(uuid,text),prefunded_card.link_inflow(uuid,text,jsonb),prefunded_card.read_operation(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
