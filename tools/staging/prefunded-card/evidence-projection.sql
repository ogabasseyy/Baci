BEGIN;
CREATE FUNCTION prefunded_card.apply_classified_inflow(p_integration uuid,p_system text,p_event text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE classified jsonb; receipt prefunded_card.provider_evidence%ROWTYPE; operation prefunded_card.operations%ROWTYPE;
DECLARE saved prefunded_card.bank_projections%ROWTYPE; goal public.customer_savings_goals%ROWTYPE; canonical numeric; reserved numeric;
DECLARE ledger_id uuid:=gen_random_uuid(); contribution uuid:=gen_random_uuid(); ledger_result jsonb; alias_owner uuid;
BEGIN
  classified:=prefunded_card.classify_provider_inflow(p_integration,p_system,p_event);
  IF classified->>'outcome' IN ('deferred','bridge_inflight') THEN RETURN 'deferred'; END IF;
  IF classified->>'outcome'='reconciliation_required' THEN RETURN 'reconciliation_required'; END IF;
  SELECT * INTO STRICT receipt FROM prefunded_card.provider_evidence WHERE integration_id=p_integration AND event_id=p_event;
  IF classified->>'outcome'='bridge_duplicate' THEN
    SELECT candidate.* INTO STRICT operation FROM prefunded_card.operations candidate
      JOIN prefunded_card.projections projection ON projection.operation_id=candidate.id
      WHERE candidate.integration_id=p_integration AND (receipt.observation->'references') ? candidate.transfer_reference;
    INSERT INTO prefunded_card.provider_aliases(integration_id,provider_transaction_id,operation_id)
      VALUES(p_integration,receipt.observation->>'providerTransactionId',operation.id) ON CONFLICT DO NOTHING;
    SELECT operation_id INTO alias_owner FROM prefunded_card.provider_aliases WHERE integration_id=p_integration
      AND provider_transaction_id=receipt.observation->>'providerTransactionId';
    IF alias_owner IS DISTINCT FROM operation.id THEN RAISE EXCEPTION 'provider inflow alias conflict' USING ERRCODE='23505'; END IF;
    RETURN 'duplicate';
  END IF;
  IF classified->>'outcome'<>'bank_inflow' THEN RETURN 'deferred'; END IF;
  PERFORM goal_id FROM piggyvest_savings_ledger.bindings WHERE integration_id=p_integration
    AND goal_id=(classified->>'goalId')::uuid AND merchant_id=(classified->>'merchantId')::uuid
    AND customer_id=(classified->>'customerId')::uuid AND enabled AND authorized_login=session_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank projection scope refused' USING ERRCODE='42501'; END IF;
  PERFORM mapping.goal_id FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    WHERE mapping.integration_id=p_integration AND mapping.goal_id=(classified->>'goalId')::uuid
      AND mapping.merchant_id=(classified->>'merchantId')::uuid AND mapping.customer_id=(classified->>'customerId')::uuid
      AND mapping.provider_wallet_id=classified->>'destinationWalletId' AND mapping.provider_customer_id=classified->>'destinationCustomerId'
    FOR SHARE OF mapping,customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank projection ownership refused' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT goal FROM public.customer_savings_goals WHERE id=(classified->>'goalId')::uuid
    AND merchant_id=(classified->>'merchantId')::uuid AND customer_id=(classified->>'customerId')::uuid FOR UPDATE;
  SELECT * INTO saved FROM prefunded_card.bank_projections WHERE integration_id=p_integration
    AND provider_transaction_id=classified->>'providerTransactionId';
  IF FOUND THEN
    IF saved.goal_id IS DISTINCT FROM goal.id OR saved.merchant_id IS DISTINCT FROM goal.merchant_id
      OR saved.customer_id IS DISTINCT FROM goal.customer_id OR saved.amount_kobo IS DISTINCT FROM (classified->>'amountKobo')::bigint THEN
      RAISE EXCEPTION 'bank projection duplicate identity conflict' USING ERRCODE='23505'; END IF;
    RETURN 'duplicate';
  END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.bank_projections projection
    JOIN prefunded_card.provider_evidence earlier ON earlier.integration_id=projection.integration_id AND earlier.event_id=projection.event_id
    WHERE projection.integration_id=p_integration AND (earlier.observation->'references') ?|
      ARRAY(SELECT jsonb_array_elements_text(receipt.observation->'references'))) THEN RETURN 'reconciliation_required'; END IF;
  IF goal.status<>'active' OR goal.completed_at IS NOT NULL OR goal.cancelled_at IS NOT NULL OR goal.spent_at IS NOT NULL THEN RETURN 'deferred'; END IF;
  SELECT coalesce(sum(posting.amount_kobo),0) INTO canonical FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations entry ON entry.id=posting.operation_id
    WHERE entry.integration_id=p_integration AND entry.goal_id=goal.id AND posting.account='principal';
  IF canonical IS DISTINCT FROM goal.current_amount*100 THEN RAISE EXCEPTION 'bank projection requires reconciled principal' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(amount_kobo),0) INTO reserved FROM prefunded_card.operations WHERE goal_id=goal.id
    AND collection_status NOT IN ('verified_failed','reversed') AND projection_status<>'applied';
  IF goal.current_amount*100+reserved+(classified->>'amountKobo')::bigint>goal.target_amount*100 THEN RETURN 'deferred'; END IF;
  ledger_result:=piggyvest_savings_ledger.apply(p_integration,goal.merchant_id,goal.customer_id,goal.id,
    jsonb_build_object('operationId',ledger_id,'kind','credit_principal','principalKobo',(classified->>'amountKobo')::bigint,
      'interestKobo',0,'evidenceId','pvb-bank:'||ledger_id,'referenceId',NULL));
  IF ledger_result->>'outcome'<>'recorded' OR ledger_result->>'operationId'<>ledger_id::text THEN RAISE EXCEPTION 'bank canonical acknowledgement refused'; END IF;
  INSERT INTO prefunded_card.bank_projections(integration_id,provider_transaction_id,event_id,operation_id,contribution_id,
    merchant_id,customer_id,goal_id,amount_kobo) VALUES(p_integration,classified->>'providerTransactionId',p_event,ledger_id,contribution,
    goal.merchant_id,goal.customer_id,goal.id,(classified->>'amountKobo')::bigint);
  INSERT INTO public.customer_savings_contributions(id,goal_id,merchant_id,customer_id,amount,source_type,status,processed_at,idempotency_key,metadata)
    VALUES(contribution,goal.id,goal.merchant_id,goal.customer_id,(classified->>'amountKobo')::numeric/100,'piggyvest_inflow','completed',clock_timestamp(),
      'pvb-bank:'||ledger_id,jsonb_build_object('funding_model','verified_piggyvest_bank','provider_transaction_id',classified->>'providerTransactionId'));
  UPDATE public.customer_savings_goals SET current_amount=current_amount+(classified->>'amountKobo')::numeric/100,
    status=CASE WHEN current_amount+(classified->>'amountKobo')::numeric/100=target_amount THEN 'completed' ELSE 'active' END,
    completed_at=CASE WHEN current_amount+(classified->>'amountKobo')::numeric/100=target_amount THEN clock_timestamp() ELSE completed_at END,
    updated_at=clock_timestamp() WHERE id=goal.id;
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.apply_classified_inflow(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
COMMIT;
