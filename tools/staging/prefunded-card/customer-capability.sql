BEGIN;
CREATE FUNCTION prefunded_card.customer_capabilities(p_integration uuid,p_merchant uuid,p_customer uuid,p_goal uuid,
  p_actor uuid,p_business text,p_system text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE treasury prefunded_card.treasury_bindings%ROWTYPE;
DECLARE treasury_snapshot prefunded_card.treasury_snapshots%ROWTYPE;
DECLARE route_context prefunded_card.operations%ROWTYPE;
DECLARE goal public.customer_savings_goals%ROWTYPE; candidate record; proof jsonb;
DECLARE saved_methods jsonb:='[]'::jsonb; disabled jsonb; pending_kobo numeric; principal_kobo numeric;
DECLARE remaining_kobo numeric; maximum_kobo numeric; count_bindings integer;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
    OR p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
    OR p_input IS DISTINCT FROM jsonb_build_object('goalId',p_goal::text) THEN
    RAISE EXCEPTION 'prefunded customer capability unavailable' USING ERRCODE='42501'; END IF;
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_ledger_worker');
  PERFORM customer.id FROM public.customers customer JOIN public.customer_savings_goals owned
    ON owned.customer_id=customer.id AND owned.merchant_id=customer.merchant_id
    WHERE customer.id=p_customer AND customer.merchant_id=p_merchant AND customer.user_id=p_actor
      AND owned.id=p_goal FOR SHARE OF customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded customer capability unavailable' USING ERRCODE='42501'; END IF;
  PERFORM id FROM piggyvest_staging.integrations WHERE id=p_integration AND enabled
    AND expected_provider_account_id=p_business FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded customer capability unavailable' USING ERRCODE='42501'; END IF;
  disabled:=jsonb_build_object('goalId',p_goal,'enabled',false,'newCardEnabled',false,'currency','NGN',
    'maximumAmountKobo',0,'savedMethods','[]'::jsonb);
  SELECT count(*) INTO count_bindings FROM prefunded_card.treasury_bindings
    WHERE integration_id=p_integration AND merchant_id=p_merchant AND expected_business_id=p_business
      AND authorized_login=session_user;
  IF count_bindings<>1 THEN RETURN disabled; END IF;
  SELECT binding.* INTO treasury FROM prefunded_card.treasury_bindings binding
    WHERE binding.integration_id=p_integration AND binding.merchant_id=p_merchant
      AND binding.expected_business_id=p_business AND binding.authorized_login=session_user
      AND binding.enabled AND binding.currency='NGN' FOR UPDATE OF binding;
  IF NOT FOUND THEN RETURN disabled; END IF;
  PERFORM identity.treasury_binding_id FROM prefunded_card.treasury_identities identity
    WHERE identity.treasury_binding_id=treasury.id AND identity.integration_id=treasury.integration_id
      AND identity.merchant_id=treasury.merchant_id AND identity.expected_business_id=treasury.expected_business_id
      AND identity.source_wallet_id=treasury.source_wallet_id AND identity.authorized_login=treasury.authorized_login
    FOR SHARE OF identity;
  IF NOT FOUND THEN RETURN disabled; END IF;
  PERFORM prefunded_card.authorization_scope(treasury.id,p_integration,p_merchant,p_system,false);
  IF NOT prefunded_card.treasury_reservation_ready(treasury.id) THEN RETURN disabled; END IF;
  SELECT * INTO treasury_snapshot FROM prefunded_card.treasury_snapshots snapshot
    WHERE snapshot.treasury_binding_id=treasury.id
    ORDER BY snapshot.sequence_number DESC LIMIT 1 FOR SHARE OF snapshot;
  PERFORM route.goal_id FROM prefunded_card.credit_routes route
    JOIN piggyvest_savings_ledger.bindings binding ON binding.goal_id=route.goal_id
      AND binding.integration_id=route.integration_id AND binding.merchant_id=route.merchant_id
      AND binding.customer_id=route.customer_id AND binding.enabled AND binding.authorized_login=session_user
    JOIN piggyvest_staging.wallet_goal_mappings mapping ON mapping.goal_id=route.goal_id
      AND mapping.integration_id=route.integration_id AND mapping.merchant_id=route.merchant_id
      AND mapping.customer_id=route.customer_id AND mapping.provider_wallet_id<>treasury.source_wallet_id
    WHERE route.goal_id=p_goal AND route.integration_id=p_integration AND route.merchant_id=p_merchant
      AND route.customer_id=p_customer AND route.system_identifier=p_system FOR SHARE OF route,binding,mapping;
  IF NOT FOUND THEN RETURN disabled; END IF;
  route_context.integration_id:=p_integration; route_context.merchant_id:=p_merchant;
  route_context.customer_id:=p_customer; route_context.goal_id:=p_goal; route_context.treasury_binding_id:=treasury.id;
  SELECT provider_wallet_id,provider_customer_id INTO STRICT route_context.destination_wallet_id,route_context.destination_customer_id
    FROM piggyvest_staging.wallet_goal_mappings WHERE integration_id=p_integration AND merchant_id=p_merchant
      AND customer_id=p_customer AND goal_id=p_goal;
  PERFORM prefunded_card.require_credit_route(route_context,p_system);
  SELECT * INTO goal FROM public.customer_savings_goals WHERE id=p_goal AND merchant_id=p_merchant
    AND customer_id=p_customer AND goal_kind='legacy' AND status='active' AND completed_at IS NULL AND cancelled_at IS NULL
    AND spent_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN disabled; END IF;
  SELECT coalesce(sum(posting.amount_kobo),0) INTO principal_kobo FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id
    WHERE operation.goal_id=p_goal AND operation.integration_id=p_integration AND posting.account='principal';
  IF principal_kobo IS DISTINCT FROM goal.current_amount*100 THEN RETURN disabled; END IF;
  SELECT coalesce(sum(amount_kobo),0) INTO pending_kobo FROM prefunded_card.operations WHERE goal_id=p_goal
    AND collection_status NOT IN ('verified_failed','reversed') AND projection_status<>'applied';
  remaining_kobo:=greatest(0,(goal.target_amount-goal.current_amount)*100-pending_kobo);
  IF remaining_kobo>9007199254740991 OR trunc(remaining_kobo)<>remaining_kobo THEN RETURN disabled; END IF;
  maximum_kobo:=greatest(0,least(remaining_kobo,
    treasury.verified_available_kobo-treasury.reserved_kobo-treasury.consumed_kobo,
    treasury_snapshot.available_kobo-treasury.reserved_kobo));
  FOR candidate IN
    SELECT method.id,btrim(method.brand) AS brand,method.last4 FROM public.customer_saved_payment_methods method
      JOIN prefunded_card.authorization_bindings binding ON binding.saved_method_id=method.id
        AND binding.treasury_binding_id=treasury.id AND binding.integration_id=p_integration
        AND binding.merchant_id=p_merchant AND binding.customer_id=p_customer
        AND binding.system_identifier=p_system AND binding.database_name=current_database()
        AND binding.authorized_login=session_user AND binding.reusable
      WHERE method.merchant_id=p_merchant AND method.customer_id=p_customer AND method.provider='paystack'
        AND method.is_active AND method.reusable AND method.disabled_at IS NULL
        AND octet_length(btrim(method.brand)) BETWEEN 1 AND 64 AND method.brand !~ '[[:cntrl:]]'
        AND method.last4 ~ '^[0-9]{4}$' ORDER BY method.id LIMIT 20 FOR SHARE OF method,binding
  LOOP
    proof:=prefunded_card.read_authorization(treasury.id,p_integration,p_merchant,p_customer,candidate.id,p_system);
    IF proof->'active'='true'::jsonb AND proof->'reusable'='true'::jsonb THEN
      saved_methods:=saved_methods||jsonb_build_array(jsonb_build_object('id',candidate.id,'brand',candidate.brand,'last4',candidate.last4));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('goalId',p_goal,'enabled',maximum_kobo>0 AND jsonb_array_length(saved_methods)>0,
    'newCardEnabled',false,'currency','NGN','maximumAmountKobo',maximum_kobo,'savedMethods',saved_methods);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'prefunded customer capability unavailable' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
