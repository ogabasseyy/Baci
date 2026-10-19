BEGIN;
CREATE TABLE piggyvest_savings_ledger.interest_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL,
  provider_business_id text NOT NULL CHECK (length(provider_business_id) BETWEEN 1 AND 128),
  payout_id text NOT NULL CHECK (length(payout_id) BETWEEN 1 AND 128),
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  economics jsonb NOT NULL,
  customer_amount_kobo bigint NOT NULL CHECK (customer_amount_kobo BETWEEN 1 AND 9007199254740991),
  eligibility_evidence text NOT NULL CHECK (length(eligibility_evidence) BETWEEN 1 AND 128),
  policy_reference text NOT NULL CHECK (length(policy_reference) BETWEEN 1 AND 128),
  enabled boolean NOT NULL DEFAULT false,
  UNIQUE (integration_id, payout_id),
  FOREIGN KEY (integration_id, merchant_id, customer_id, goal_id)
    REFERENCES piggyvest_savings_ledger.bindings(integration_id, merchant_id, customer_id, goal_id)
);
CREATE INDEX interest_allocations_goal_idx ON piggyvest_savings_ledger.interest_allocations(goal_id);
CREATE INDEX interest_allocations_merchant_idx ON piggyvest_savings_ledger.interest_allocations(merchant_id);
CREATE INDEX interest_allocations_customer_idx ON piggyvest_savings_ledger.interest_allocations(customer_id);
CREATE TABLE piggyvest_savings_ledger.interest_receipts (
  allocation_id uuid PRIMARY KEY REFERENCES piggyvest_savings_ledger.interest_allocations(id),
  first_event_id text NOT NULL CHECK (length(first_event_id) BETWEEN 1 AND 128),
  economics jsonb NOT NULL,
  operation_id uuid NOT NULL UNIQUE REFERENCES piggyvest_savings_ledger.operations(id),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE piggyvest_savings_ledger.interest_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_savings_ledger.interest_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON piggyvest_savings_ledger.interest_allocations,
  piggyvest_savings_ledger.interest_receipts FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER interest_receipts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON piggyvest_savings_ledger.interest_receipts FOR EACH STATEMENT
  EXECUTE FUNCTION piggyvest_savings_ledger.immutable();

CREATE FUNCTION piggyvest_savings_ledger.valid_interest_economics(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE field text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_value)) <> 10 OR NOT p_value ?&
    ARRAY['payoutId','providerCustomerId','sourceWalletId','destinationWalletId','reference',
      'currency','amountKobo','grossKobo','taxKobo','netKobo'] THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['payoutId','providerCustomerId','sourceWalletId','destinationWalletId','reference','currency'] LOOP
    IF jsonb_typeof(p_value->field) <> 'string' OR length(p_value->>field) NOT BETWEEN 1 AND 128
      THEN RETURN false; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['amountKobo','grossKobo','taxKobo','netKobo'] LOOP
    IF jsonb_typeof(p_value->field) <> 'number' THEN RETURN false; END IF;
    IF (p_value->>field)::numeric NOT BETWEEN 0 AND 9007199254740991
      OR trunc((p_value->>field)::numeric) <> (p_value->>field)::numeric THEN RETURN false; END IF;
  END LOOP;
  RETURN p_value->>'currency' = 'NGN'
    AND (p_value->>'amountKobo')::numeric = (p_value->>'netKobo')::numeric
    AND (p_value->>'grossKobo')::numeric - (p_value->>'taxKobo')::numeric = (p_value->>'netKobo')::numeric;
END $$;

CREATE FUNCTION piggyvest_savings_ledger.guard_interest_allocation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'interest allocation immutable'; END IF;
    IF (to_jsonb(NEW) - 'enabled') IS DISTINCT FROM (to_jsonb(OLD) - 'enabled') THEN
      RAISE EXCEPTION 'interest allocation immutable';
    END IF;
  END IF;
  IF NOT piggyvest_savings_ledger.valid_interest_economics(NEW.economics)
    OR NEW.economics->>'payoutId' <> NEW.payout_id
    OR NEW.customer_amount_kobo > (NEW.economics->>'netKobo')::numeric THEN
    RAISE EXCEPTION 'invalid interest allocation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER interest_allocation_guard BEFORE INSERT OR UPDATE OR DELETE
  ON piggyvest_savings_ledger.interest_allocations FOR EACH ROW
  EXECUTE FUNCTION piggyvest_savings_ledger.guard_interest_allocation();
CREATE TRIGGER interest_allocation_no_truncate BEFORE TRUNCATE
  ON piggyvest_savings_ledger.interest_allocations FOR EACH STATEMENT
  EXECUTE FUNCTION piggyvest_savings_ledger.immutable();

CREATE FUNCTION piggyvest_savings_ledger.apply_interest_receipt(
  p_integration uuid, p_business text, p_system_id text, p_economics jsonb, p_event_id text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE allocation piggyvest_savings_ledger.interest_allocations%ROWTYPE;
  stored piggyvest_savings_ledger.interest_receipts%ROWTYPE;
  acknowledgement jsonb;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed'
    OR session_user <> 'piggyvest_staging_ledger_worker'
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
REVOKE ALL ON FUNCTION piggyvest_savings_ledger.valid_interest_economics(jsonb),
  piggyvest_savings_ledger.guard_interest_allocation(),
  piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
