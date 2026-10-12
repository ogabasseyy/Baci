BEGIN;
CREATE FUNCTION piggyvest_savings_exit_execution.valid_policy_reference(p_policy jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_policy IS NOT NULL AND jsonb_typeof(p_policy) = 'object' AND (SELECT count(*) FROM jsonb_object_keys(p_policy)) = 1
    AND p_policy ? 'policyId' AND jsonb_typeof(p_policy->'policyId') = 'string'
    AND p_policy->>'policyId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$$;
CREATE FUNCTION piggyvest_savings_exit_execution.begin(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text,
  p_actor uuid, p_operation uuid, p_action text, p_policy_reference jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE saved piggyvest_savings_exit_execution.operations%ROWTYPE; policy piggyvest_savings_exit_execution.provisioned_policies%ROWTYPE;
  purchase piggyvest_purchase_preparation.intents%ROWTYPE; cancellation piggyvest_cancel_plan.intents%ROWTYPE;
  quote piggyvest_purchase_preparation.quotes%ROWTYPE; transfer jsonb; amount bigint; authority_snapshot jsonb;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR session_user <> 'piggyvest_staging_policy_writer'
    OR inet_client_addr() IS NOT NULL OR current_database() <> 'piggyvest_local' OR p_action NOT IN ('purchase','cancellation')
    OR NOT piggyvest_savings_exit_execution.valid_policy_reference(p_policy_reference) THEN RAISE EXCEPTION 'savings exit execution denied' USING ERRCODE = '42501'; END IF;
  PERFORM piggyvest_goal_policy.lock_scope(p_integration,p_merchant,p_customer,p_goal,p_business);
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.customers customer WHERE customer.id=p_customer AND customer.merchant_id=p_merchant AND customer.user_id=p_actor)
    OR NOT EXISTS (SELECT 1 FROM piggyvest_savings_ledger.bindings binding WHERE binding.integration_id=p_integration AND binding.merchant_id=p_merchant AND binding.customer_id=p_customer AND binding.goal_id=p_goal AND binding.authorized_login=session_user AND binding.enabled) THEN RAISE EXCEPTION 'savings exit scope denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO saved FROM piggyvest_savings_exit_execution.operations WHERE operation_id=p_operation FOR UPDATE;
  IF FOUND THEN
    IF saved.integration_id<>p_integration OR saved.merchant_id<>p_merchant OR saved.customer_id<>p_customer OR saved.goal_id<>p_goal OR saved.actor_id<>p_actor OR saved.action<>p_action OR saved.policy IS DISTINCT FROM p_policy_reference THEN RAISE EXCEPTION 'savings exit replay conflict' USING ERRCODE = '23505'; END IF;
    RETURN jsonb_strip_nulls(jsonb_build_object('state',saved.state,'operationId',saved.operation_id,'transfer',CASE WHEN saved.state='verify' THEN saved.transfer ELSE NULL END));
  END IF;
  SELECT * INTO policy FROM piggyvest_savings_exit_execution.provisioned_policies provisioned
  WHERE provisioned.policy_id=(p_policy_reference->>'policyId')::uuid AND provisioned.integration_id=p_integration AND provisioned.merchant_id=p_merchant AND provisioned.customer_id=p_customer AND provisioned.goal_id=p_goal AND provisioned.action=p_action
    AND EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings source WHERE source.integration_id=provisioned.integration_id AND source.merchant_id=provisioned.merchant_id AND source.customer_id=provisioned.customer_id AND source.goal_id=provisioned.goal_id AND source.provider_wallet_id=provisioned.source_wallet_id)
    AND EXISTS (SELECT 1 FROM piggyvest_savings_exit_execution.wallet_authorities destination WHERE destination.integration_id=provisioned.integration_id AND destination.merchant_id=provisioned.merchant_id AND destination.provider_wallet_id=provisioned.purchase_destination_wallet_id AND destination.authority_kind='merchant')
    AND EXISTS (SELECT 1 FROM piggyvest_savings_exit_execution.wallet_authorities destination WHERE destination.integration_id=provisioned.integration_id AND destination.merchant_id=provisioned.merchant_id AND destination.customer_id=provisioned.customer_id AND destination.provider_wallet_id=provisioned.cancellation_destination_wallet_id AND destination.authority_kind='customer') FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','deferred','operationId',p_operation); END IF;
  authority_snapshot:=jsonb_build_object('policyId',policy.policy_id,'version',policy.version,'revisionId',policy.revision_id,'sourceWalletId',policy.source_wallet_id,'purchaseDestinationWalletId',policy.purchase_destination_wallet_id,'cancellationDestinationWalletId',policy.cancellation_destination_wallet_id,'purchaseRequiresFullyFundedGoal',policy.purchase_requires_fully_funded_goal,'purchasePaidInterestDisposition',policy.purchase_paid_interest_disposition,'cancellationPrincipalDisposition',policy.cancellation_principal_disposition,'cancellationPaidInterestDisposition',policy.cancellation_paid_interest_disposition,'cancellationPendingInterestDisposition',policy.cancellation_pending_interest_disposition,'cancellationFeeKobo',policy.cancellation_fee_kobo);
  IF p_action='purchase' THEN
    SELECT * INTO purchase FROM piggyvest_purchase_preparation.intents WHERE operation_id=p_operation AND goal_id=p_goal AND actor_id=p_actor;
    IF NOT FOUND THEN RETURN jsonb_build_object('state','deferred','operationId',p_operation); END IF;
    SELECT * INTO quote FROM piggyvest_purchase_preparation.quotes WHERE id=purchase.quote_id FOR SHARE;
    IF NOT FOUND OR quote.revision_id<>policy.revision_id OR purchase.receipt->>'otherPaymentKobo'<>'0' OR purchase.receipt->>'paidInterestKobo'<>'0' OR purchase.receipt->>'savingsKobo' IS DISTINCT FROM (quote.current_device_kobo+quote.delivery_kobo+quote.tax_kobo+quote.fee_kobo)::text THEN RETURN jsonb_build_object('state','deferred','operationId',p_operation); END IF;
    amount:=(purchase.receipt->>'savingsKobo')::numeric::bigint;
    transfer:=jsonb_build_object('action',p_action,'operationId',p_operation,'reference',p_operation,'sourceWalletId',policy.source_wallet_id,'destinationWalletId',policy.purchase_destination_wallet_id,'amountKobo',amount,'currency','NGN');
  ELSE
    SELECT * INTO cancellation FROM piggyvest_cancel_plan.intents WHERE operation_id=p_operation AND goal_id=p_goal;
    IF NOT FOUND OR cancellation.command->>'revisionId' IS DISTINCT FROM policy.revision_id::text THEN RETURN jsonb_build_object('state','deferred','operationId',p_operation); END IF;
    amount:=(cancellation.command->>'principalKobo')::numeric::bigint-policy.cancellation_fee_kobo;
    IF amount<=0 THEN RETURN jsonb_build_object('state','deferred','operationId',p_operation); END IF;
    transfer:=jsonb_build_object('action',p_action,'operationId',p_operation,'reference',p_operation,'sourceWalletId',policy.source_wallet_id,'destinationWalletId',policy.cancellation_destination_wallet_id,'amountKobo',amount,'currency','NGN');
  END IF;
  INSERT INTO piggyvest_savings_exit_execution.operations(operation_id,integration_id,merchant_id,customer_id,goal_id,actor_id,action,policy,transfer,state,authority_snapshot)
  VALUES(p_operation,p_integration,p_merchant,p_customer,p_goal,p_actor,p_action,p_policy_reference,transfer,'verify',authority_snapshot);
  RETURN jsonb_build_object('state','submit','operationId',p_operation,'transfer',transfer);
END $$;
CREATE OR REPLACE FUNCTION piggyvest_savings_exit_execution.record_finality(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text, p_actor uuid, p_operation uuid, p_finality jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE saved piggyvest_savings_exit_execution.operations%ROWTYPE; projection_kind text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR session_user <> 'piggyvest_staging_policy_writer' OR inet_client_addr() IS NOT NULL OR current_database() <> 'piggyvest_local' OR p_finality IS NULL OR jsonb_typeof(p_finality)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_finality))<>8 OR NOT p_finality ?& ARRAY['action','operationId','reference','sourceWalletId','destinationWalletId','amountKobo','currency','status'] OR p_finality->>'status' NOT IN ('success','pending','failed','unknown') THEN RAISE EXCEPTION 'savings exit finality denied' USING ERRCODE='42501'; END IF;
  PERFORM piggyvest_goal_policy.lock_scope(p_integration,p_merchant,p_customer,p_goal,p_business);
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.customers customer WHERE customer.id=p_customer AND customer.merchant_id=p_merchant AND customer.user_id=p_actor) OR NOT EXISTS (SELECT 1 FROM piggyvest_savings_ledger.bindings binding WHERE binding.integration_id=p_integration AND binding.merchant_id=p_merchant AND binding.customer_id=p_customer AND binding.goal_id=p_goal AND binding.authorized_login=session_user AND binding.enabled) THEN RAISE EXCEPTION 'savings exit scope denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO saved FROM piggyvest_savings_exit_execution.operations WHERE operation_id=p_operation AND integration_id=p_integration AND merchant_id=p_merchant AND customer_id=p_customer AND goal_id=p_goal AND actor_id=p_actor FOR UPDATE;
  IF NOT FOUND OR (saved.transfer||jsonb_build_object('status',p_finality->>'status')) IS DISTINCT FROM p_finality THEN RAISE EXCEPTION 'savings exit finality conflict' USING ERRCODE='23505'; END IF;
  IF saved.state IN ('pending_projection','requires_reconciliation') THEN IF saved.finality IS DISTINCT FROM p_finality THEN RAISE EXCEPTION 'savings exit terminal conflict' USING ERRCODE='23505'; END IF; RETURN jsonb_build_object('state',saved.state,'operationId',saved.operation_id); END IF;
  IF p_finality->>'status' IN ('pending','unknown') THEN RETURN jsonb_build_object('state','pending','operationId',saved.operation_id); END IF;
  IF p_finality->>'status'='failed' THEN
    INSERT INTO piggyvest_savings_exit_execution.reconciliation_obligations(operation_id,state,finality) VALUES(saved.operation_id,'requires_release_or_recovery',p_finality) ON CONFLICT (operation_id) DO NOTHING;
    UPDATE piggyvest_savings_exit_execution.operations SET state='requires_reconciliation',finality=p_finality,finalized_at=clock_timestamp() WHERE operation_id=saved.operation_id;
    RETURN jsonb_build_object('state','requires_reconciliation','operationId',saved.operation_id);
  END IF;
  projection_kind:=CASE WHEN saved.action='purchase' THEN 'pending_order' ELSE 'pending_refund' END;
  INSERT INTO piggyvest_savings_exit_execution.projection_queue(projection_id,operation_id,projection_kind,state,authority_snapshot,transfer,finality) VALUES(saved.operation_id,saved.operation_id,projection_kind,'pending_projection',saved.authority_snapshot,saved.transfer,p_finality) ON CONFLICT (operation_id) DO NOTHING;
  UPDATE piggyvest_savings_exit_execution.operations SET state='pending_projection',finality=p_finality,finalized_at=clock_timestamp() WHERE operation_id=saved.operation_id;
  RETURN jsonb_build_object('state','pending_projection','operationId',saved.operation_id);
END $$;
REVOKE ALL ON FUNCTION piggyvest_savings_exit_execution.valid_policy_reference(jsonb), piggyvest_savings_exit_execution.begin(uuid,uuid,uuid,uuid,text,uuid,uuid,text,jsonb), piggyvest_savings_exit_execution.record_finality(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
