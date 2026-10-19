BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_savings_ledger.apply_interest_receipt(
  p_integration uuid, p_business text, p_system_id text, p_economics jsonb, p_event_id text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE allocation piggyvest_savings_ledger.interest_allocations%ROWTYPE;
  stored piggyvest_savings_ledger.interest_receipts%ROWTYPE;
  acknowledgement jsonb;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed'
    OR session_user NOT IN ('piggyvest_staging_ledger_worker', 'prefunded_treasury_operator')
    OR p_system_id IS NULL
    OR p_system_id IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system()) THEN
    RAISE EXCEPTION 'interest bridge identity refused' USING ERRCODE = '42501';
  END IF;
  IF NOT piggyvest_savings_ledger.valid_interest_economics(p_economics)
    OR p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN
    RETURN 'invalid';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id = p_integration AND registry.enabled
      AND registry.expected_provider_account_id = p_business FOR SHARE;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  SELECT approval.id, approval.integration_id, approval.provider_business_id, approval.payout_id,
    approval.merchant_id, approval.customer_id, approval.goal_id, approval.economics,
    approval.customer_amount_kobo, approval.eligibility_evidence, approval.policy_reference, approval.enabled
    INTO allocation FROM piggyvest_savings_ledger.interest_allocations approval
    WHERE approval.integration_id = p_integration AND approval.provider_business_id = p_business
      AND approval.payout_id = p_economics->>'payoutId';
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  PERFORM binding.goal_id FROM piggyvest_savings_ledger.bindings binding
    WHERE binding.integration_id = p_integration AND binding.goal_id = allocation.goal_id
      AND binding.merchant_id = allocation.merchant_id AND binding.customer_id = allocation.customer_id
      AND binding.authorized_login = session_user AND binding.enabled FOR UPDATE;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  PERFORM approval.id FROM piggyvest_savings_ledger.interest_allocations approval
    WHERE approval.id = allocation.id AND approval.enabled FOR UPDATE;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  IF allocation.economics IS DISTINCT FROM p_economics THEN RETURN 'conflict'; END IF;
  PERFORM customer.id FROM public.customers customer
    WHERE customer.id = allocation.customer_id AND customer.merchant_id = allocation.merchant_id FOR SHARE;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  PERFORM goal.id FROM public.customer_savings_goals goal WHERE goal.id = allocation.goal_id
    AND goal.customer_id = allocation.customer_id AND goal.merchant_id = allocation.merchant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  SELECT receipt.allocation_id, receipt.first_event_id, receipt.economics, receipt.operation_id, receipt.received_at
    INTO stored FROM piggyvest_savings_ledger.interest_receipts receipt WHERE receipt.allocation_id = allocation.id;
  IF FOUND THEN
    IF stored.economics IS DISTINCT FROM p_economics THEN RETURN 'conflict'; END IF;
    RETURN 'duplicate';
  END IF;
  acknowledgement := piggyvest_savings_ledger.apply(p_integration,allocation.merchant_id,
      allocation.customer_id,allocation.goal_id,jsonb_build_object('operationId',allocation.id,
        'kind','credit_eligible_paid_interest','principalKobo',0,'interestKobo',allocation.customer_amount_kobo,
        'evidenceId','pvb-interest:' || allocation.id,'referenceId',NULL));
  IF acknowledgement->>'outcome' IS DISTINCT FROM 'recorded' THEN
    RAISE EXCEPTION 'interest ledger acknowledgement refused';
  END IF;
  INSERT INTO piggyvest_savings_ledger.interest_receipts(allocation_id,first_event_id,economics,operation_id)
    VALUES (allocation.id,p_event_id,p_economics,allocation.id);
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
