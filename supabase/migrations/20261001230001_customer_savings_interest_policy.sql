BEGIN;

CREATE TABLE IF NOT EXISTS piggyvest_savings_ledger.interest_policies (
  goal_id uuid PRIMARY KEY,
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  provider_business_id text NOT NULL CHECK (length(provider_business_id) BETWEEN 1 AND 128),
  provider_customer_id text NOT NULL CHECK (length(provider_customer_id) BETWEEN 1 AND 128),
  interest_source_wallet_id text NOT NULL CHECK (length(interest_source_wallet_id) BETWEEN 1 AND 128),
  payout_wallet_id text NOT NULL CHECK (length(payout_wallet_id) BETWEEN 1 AND 128),
  interest_enabled boolean NOT NULL DEFAULT false,
  eligibility_evidence text NOT NULL CHECK (length(eligibility_evidence) BETWEEN 1 AND 128),
  policy_reference text NOT NULL CHECK (length(policy_reference) BETWEEN 1 AND 128),
  expires_at timestamptz NOT NULL,
  enabled boolean NOT NULL DEFAULT false CHECK (NOT enabled OR interest_enabled),
  UNIQUE (integration_id, provider_customer_id, interest_source_wallet_id, payout_wallet_id),
  FOREIGN KEY (integration_id, merchant_id, customer_id, goal_id)
    REFERENCES piggyvest_savings_ledger.bindings(integration_id, merchant_id, customer_id, goal_id)
);
CREATE INDEX IF NOT EXISTS interest_policies_merchant_idx ON piggyvest_savings_ledger.interest_policies(merchant_id);
CREATE INDEX IF NOT EXISTS interest_policies_customer_idx ON piggyvest_savings_ledger.interest_policies(customer_id);
ALTER TABLE piggyvest_savings_ledger.interest_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON piggyvest_savings_ledger.interest_policies FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION piggyvest_savings_ledger.guard_interest_policy()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'enabled' - 'expires_at')
    IS NOT DISTINCT FROM (to_jsonb(OLD) - 'enabled' - 'expires_at') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'interest policy identity immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER interest_policy_guard BEFORE INSERT OR UPDATE OR DELETE
  ON piggyvest_savings_ledger.interest_policies FOR EACH ROW
  EXECUTE FUNCTION piggyvest_savings_ledger.guard_interest_policy();
CREATE TRIGGER interest_policy_no_truncate BEFORE TRUNCATE
  ON piggyvest_savings_ledger.interest_policies FOR EACH STATEMENT
  EXECUTE FUNCTION piggyvest_savings_ledger.immutable();

CREATE OR REPLACE FUNCTION piggyvest_savings_ledger.prepare_interest_allocation(
  p_integration uuid, p_business text, p_economics jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE policy piggyvest_savings_ledger.interest_policies%ROWTYPE;
BEGIN
  IF session_user NOT IN ('piggyvest_staging_ledger_worker','prefunded_treasury_operator')
    OR NOT piggyvest_savings_ledger.valid_interest_economics(p_economics)
    OR (p_economics->>'netKobo')::numeric <= 0 THEN RETURN false; END IF;
  SELECT approved.goal_id,approved.integration_id,approved.merchant_id,approved.customer_id,
    approved.provider_business_id,approved.provider_customer_id,approved.interest_source_wallet_id,
    approved.payout_wallet_id,approved.interest_enabled,approved.eligibility_evidence,
    approved.policy_reference,approved.expires_at,approved.enabled INTO policy
    FROM piggyvest_savings_ledger.interest_policies approved
    JOIN piggyvest_savings_ledger.bindings binding ON binding.goal_id=approved.goal_id
      AND binding.integration_id=approved.integration_id AND binding.merchant_id=approved.merchant_id
      AND binding.customer_id=approved.customer_id AND binding.enabled AND binding.authorized_login=session_user
    JOIN public.customers customer ON customer.id=approved.customer_id
      AND customer.merchant_id=approved.merchant_id AND customer.deleted_at IS NULL
    JOIN public.customer_savings_goals goal ON goal.id=approved.goal_id
      AND goal.merchant_id=approved.merchant_id AND goal.customer_id=approved.customer_id
      AND goal.status IN ('active','paused','completed')
    WHERE approved.integration_id=p_integration AND approved.provider_business_id=p_business
      AND approved.provider_customer_id=p_economics->>'providerCustomerId'
      AND approved.interest_source_wallet_id=p_economics->>'sourceWalletId'
      AND approved.payout_wallet_id=p_economics->>'destinationWalletId'
      AND approved.enabled AND approved.interest_enabled AND approved.expires_at>clock_timestamp()
    FOR UPDATE OF approved,binding,goal FOR SHARE OF customer;
  IF NOT FOUND OR policy.expires_at<=clock_timestamp() THEN RETURN false; END IF;
  INSERT INTO piggyvest_savings_ledger.interest_allocations
    (integration_id,provider_business_id,payout_id,merchant_id,customer_id,goal_id,
     economics,customer_amount_kobo,eligibility_evidence,policy_reference,enabled)
  VALUES (p_integration,p_business,p_economics->>'payoutId',policy.merchant_id,policy.customer_id,
    policy.goal_id,p_economics,(p_economics->>'netKobo')::numeric::bigint,
    policy.eligibility_evidence,policy.policy_reference,true)
  ON CONFLICT (integration_id,payout_id) DO NOTHING;
  RETURN EXISTS (SELECT 1 FROM piggyvest_savings_ledger.interest_allocations allocation
    WHERE allocation.integration_id=p_integration AND allocation.provider_business_id=p_business
      AND allocation.payout_id=p_economics->>'payoutId' AND allocation.enabled
      AND allocation.goal_id=policy.goal_id AND allocation.merchant_id=policy.merchant_id
      AND allocation.customer_id=policy.customer_id AND allocation.economics=p_economics
      AND allocation.customer_amount_kobo=(p_economics->>'netKobo')::numeric
      AND allocation.eligibility_evidence=policy.eligibility_evidence
      AND allocation.policy_reference=policy.policy_reference);
END $$;

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
    OR p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN RETURN 'invalid'; END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id=p_integration AND registry.enabled
      AND registry.expected_provider_account_id=p_business FOR SHARE;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  SELECT approval.id,approval.integration_id,approval.provider_business_id,approval.payout_id,
    approval.merchant_id,approval.customer_id,approval.goal_id,approval.economics,
    approval.customer_amount_kobo,approval.eligibility_evidence,approval.policy_reference,
    approval.enabled INTO allocation FROM piggyvest_savings_ledger.interest_allocations approval
    WHERE approval.integration_id=p_integration AND approval.provider_business_id=p_business
      AND approval.payout_id=p_economics->>'payoutId';
  IF NOT FOUND THEN
    IF NOT piggyvest_savings_ledger.prepare_interest_allocation(p_integration,p_business,p_economics)
      THEN RETURN 'deferred'; END IF;
    SELECT approval.id,approval.integration_id,approval.provider_business_id,approval.payout_id,
      approval.merchant_id,approval.customer_id,approval.goal_id,approval.economics,
      approval.customer_amount_kobo,approval.eligibility_evidence,approval.policy_reference,
      approval.enabled INTO allocation FROM piggyvest_savings_ledger.interest_allocations approval
      WHERE approval.integration_id=p_integration AND approval.provider_business_id=p_business
        AND approval.payout_id=p_economics->>'payoutId';
    IF NOT FOUND THEN RETURN 'conflict'; END IF;
  END IF;
  PERFORM binding.goal_id FROM piggyvest_savings_ledger.bindings binding
    WHERE binding.integration_id=p_integration AND binding.goal_id=allocation.goal_id
      AND binding.merchant_id=allocation.merchant_id AND binding.customer_id=allocation.customer_id
      AND binding.authorized_login=session_user AND binding.enabled FOR UPDATE;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  PERFORM approval.id FROM piggyvest_savings_ledger.interest_allocations approval
    WHERE approval.id=allocation.id AND approval.enabled FOR UPDATE;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  IF allocation.economics IS DISTINCT FROM p_economics THEN RETURN 'conflict'; END IF;
  PERFORM customer.id FROM public.customers customer
    WHERE customer.id=allocation.customer_id AND customer.merchant_id=allocation.merchant_id
      AND customer.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  PERFORM goal.id FROM public.customer_savings_goals goal WHERE goal.id=allocation.goal_id
    AND goal.customer_id=allocation.customer_id AND goal.merchant_id=allocation.merchant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  SELECT receipt.allocation_id,receipt.first_event_id,receipt.economics,receipt.operation_id,
    receipt.received_at INTO stored FROM piggyvest_savings_ledger.interest_receipts receipt
    WHERE receipt.allocation_id=allocation.id;
  IF FOUND THEN
    IF stored.economics IS DISTINCT FROM p_economics THEN RETURN 'conflict'; END IF;
    RETURN 'duplicate';
  END IF;
  IF NOT piggyvest_savings_ledger.prepare_interest_allocation(p_integration,p_business,p_economics)
    THEN RETURN 'deferred'; END IF;
  acknowledgement := piggyvest_savings_ledger.apply(p_integration,allocation.merchant_id,
    allocation.customer_id,allocation.goal_id,jsonb_build_object('operationId',allocation.id,
      'kind','credit_eligible_paid_interest','principalKobo',0,'interestKobo',allocation.customer_amount_kobo,
      'evidenceId','pvb-interest:' || allocation.id,'referenceId',NULL));
  IF acknowledgement->>'outcome' IS DISTINCT FROM 'recorded' THEN RAISE EXCEPTION 'interest ledger acknowledgement refused'; END IF;
  INSERT INTO piggyvest_savings_ledger.interest_receipts(allocation_id,first_event_id,economics,operation_id)
    VALUES (allocation.id,p_event_id,p_economics,allocation.id);
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION piggyvest_savings_ledger.guard_interest_policy(),
  piggyvest_savings_ledger.prepare_interest_allocation(uuid,text,jsonb),
  piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_customer_savings_earnings(p_merchant_id uuid, p_include_goals boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE customer uuid; result jsonb; goals jsonb;
BEGIN
  customer := savings_notifications.customer_for(p_merchant_id);
  result := public.get_customer_savings_earnings(p_merchant_id);
  IF p_include_goals IS NOT TRUE THEN RETURN result; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('goal_id', balance.goal_id,
    'credited_interest_kobo',balance.amount) ORDER BY balance.goal_id),'[]'::jsonb) INTO goals
  FROM (
    SELECT operation.goal_id, sum(posting.amount_kobo)::numeric AS amount
    FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id
    JOIN public.customer_savings_goals goal ON goal.id=operation.goal_id
      AND goal.merchant_id=operation.merchant_id AND goal.customer_id=operation.customer_id
    WHERE operation.merchant_id=p_merchant_id AND operation.customer_id=customer
      AND posting.account='paid_interest' AND goal.status IN ('active','paused','completed')
    GROUP BY operation.goal_id
  ) balance;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(goals) item
    WHERE (item->>'credited_interest_kobo')::numeric NOT BETWEEN 0 AND 9007199254740991) THEN
    RAISE EXCEPTION 'Goal interest outside safe range' USING ERRCODE='22003';
  END IF;
  RETURN result || jsonb_build_object('goal_interest_kobo',goals);
END $$;
REVOKE ALL ON FUNCTION public.get_customer_savings_earnings(uuid,boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_savings_earnings(uuid,boolean) TO authenticated;

COMMIT;
