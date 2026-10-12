BEGIN;

CREATE SCHEMA piggyvest_savings_exit_execution;
REVOKE ALL ON SCHEMA piggyvest_savings_exit_execution FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_savings_exit_execution.operations (
  operation_id uuid PRIMARY KEY REFERENCES piggyvest_savings_ledger.operations(id),
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('purchase','cancellation')),
  policy jsonb NOT NULL,
  transfer jsonb NOT NULL,
  state text NOT NULL CHECK(state IN ('verify','settled','failed')),
  finality jsonb,
  settlement_operation_id uuid UNIQUE REFERENCES piggyvest_savings_ledger.operations(id),
  canonical_posting jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalized_at timestamptz,
  UNIQUE(integration_id, merchant_id, customer_id, goal_id, action)
);
CREATE INDEX savings_exit_execution_goal_idx
  ON piggyvest_savings_exit_execution.operations(goal_id);

ALTER TABLE piggyvest_savings_exit_execution.operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_savings_exit_execution_operations
  ON piggyvest_savings_exit_execution.operations AS RESTRICTIVE FOR ALL TO PUBLIC
  USING(false) WITH CHECK(false);
REVOKE ALL ON piggyvest_savings_exit_execution.operations FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION piggyvest_savings_exit_execution.valid_policy(p_policy jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE section jsonb; field text;
BEGIN
  IF p_policy IS NULL OR jsonb_typeof(p_policy) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_policy)) <> 5
    OR NOT p_policy ?& ARRAY['policyId','version','revisionId','purchase','cancellation'] THEN
    RETURN false;
  END IF;
  FOREACH field IN ARRAY ARRAY['policyId','revisionId'] LOOP
    IF jsonb_typeof(p_policy->field) <> 'string'
      OR p_policy->>field !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RETURN false;
    END IF;
  END LOOP;
  IF jsonb_typeof(p_policy->'version') <> 'string'
    OR length(p_policy->>'version') NOT BETWEEN 1 AND 128 THEN
    RETURN false;
  END IF;
  section := p_policy->'purchase';
  IF jsonb_typeof(section) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(section)) <> 4
    OR NOT section ?& ARRAY['requiresFullyFundedGoal','sourceWalletId','destinationWalletId','paidInterestDisposition']
    OR section->'requiresFullyFundedGoal' IS DISTINCT FROM 'true'::jsonb
    OR section->>'paidInterestDisposition' IS DISTINCT FROM 'retain' THEN
    RETURN false;
  END IF;
  section := p_policy->'cancellation';
  IF jsonb_typeof(section) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(section)) <> 6
    OR NOT section ?& ARRAY['sourceWalletId','destinationWalletId','principalDisposition',
      'paidInterestDisposition','pendingInterestDisposition','feeKobo']
    OR section->>'principalDisposition' IS DISTINCT FROM 'return_to_owned_wallet'
    OR section->>'paidInterestDisposition' IS DISTINCT FROM 'retain'
    OR section->>'pendingInterestDisposition' IS DISTINCT FROM 'retain'
    OR jsonb_typeof(section->'feeKobo') <> 'number'
    OR (section->>'feeKobo')::numeric NOT BETWEEN 0 AND 9007199254740991
    OR trunc((section->>'feeKobo')::numeric) <> (section->>'feeKobo')::numeric THEN
    RETURN false;
  END IF;
  FOREACH field IN ARRAY ARRAY['sourceWalletId','destinationWalletId'] LOOP
    IF jsonb_typeof(p_policy->'purchase'->field) <> 'string'
      OR length(p_policy->'purchase'->>field) NOT BETWEEN 1 AND 128
      OR p_policy->'purchase'->>field !~ '^[A-Za-z0-9_-]+$'
      OR jsonb_typeof(p_policy->'cancellation'->field) <> 'string'
      OR length(p_policy->'cancellation'->>field) NOT BETWEEN 1 AND 128
      OR p_policy->'cancellation'->>field !~ '^[A-Za-z0-9_-]+$' THEN
      RETURN false;
    END IF;
  END LOOP;
  IF p_policy->'purchase'->>'sourceWalletId' = p_policy->'purchase'->>'destinationWalletId'
    OR p_policy->'cancellation'->>'sourceWalletId' = p_policy->'cancellation'->>'destinationWalletId' THEN
    RETURN false;
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION piggyvest_savings_exit_execution.begin(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text,
  p_actor uuid, p_operation uuid, p_policy jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE saved piggyvest_savings_exit_execution.operations%ROWTYPE;
  purchase piggyvest_purchase_preparation.intents%ROWTYPE;
  cancellation piggyvest_cancel_plan.intents%ROWTYPE;
  quote piggyvest_purchase_preparation.quotes%ROWTYPE;
  action text; transfer jsonb; amount bigint; fee bigint := 0;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed'
    OR session_user <> 'piggyvest_staging_policy_writer'
    OR inet_client_addr() IS NOT NULL OR current_database() <> 'piggyvest_local'
    OR NOT piggyvest_savings_exit_execution.valid_policy(p_policy) THEN
    RAISE EXCEPTION 'savings exit execution denied' USING ERRCODE = '42501';
  END IF;
  PERFORM piggyvest_goal_policy.lock_scope(p_integration,p_merchant,p_customer,p_goal,p_business);
  IF p_actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.customers customer
    WHERE customer.id=p_customer AND customer.merchant_id=p_merchant AND customer.user_id=p_actor
  ) OR NOT EXISTS(
    SELECT 1 FROM piggyvest_savings_ledger.bindings binding
    WHERE binding.integration_id=p_integration AND binding.merchant_id=p_merchant
      AND binding.customer_id=p_customer AND binding.goal_id=p_goal
      AND binding.authorized_login=session_user AND binding.enabled
  ) THEN
    RAISE EXCEPTION 'savings exit scope denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO saved FROM piggyvest_savings_exit_execution.operations
    WHERE operation_id=p_operation FOR UPDATE;
  IF FOUND THEN
    IF saved.integration_id<>p_integration OR saved.merchant_id<>p_merchant
      OR saved.customer_id<>p_customer OR saved.goal_id<>p_goal OR saved.actor_id<>p_actor
      OR saved.policy<>p_policy THEN
      RAISE EXCEPTION 'savings exit replay conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'state', CASE WHEN saved.state='verify' THEN 'verify' ELSE saved.state END,
      'operationId',saved.operation_id,
      'transfer',CASE WHEN saved.state='verify' THEN saved.transfer ELSE NULL END
    ));
  END IF;
  SELECT * INTO purchase FROM piggyvest_purchase_preparation.intents
    WHERE operation_id=p_operation AND goal_id=p_goal AND actor_id=p_actor;
  IF FOUND THEN
    SELECT * INTO quote FROM piggyvest_purchase_preparation.quotes WHERE id=purchase.quote_id FOR SHARE;
    IF NOT FOUND OR quote.revision_id::text IS DISTINCT FROM p_policy->>'revisionId'
      OR purchase.receipt->>'otherPaymentKobo' IS DISTINCT FROM '0'
      OR purchase.receipt->>'paidInterestKobo' IS DISTINCT FROM '0'
      OR purchase.receipt->>'savingsKobo' IS DISTINCT FROM
        (quote.current_device_kobo + quote.delivery_kobo + quote.tax_kobo + quote.fee_kobo)::text THEN
      RETURN jsonb_build_object('state','deferred','operationId',p_operation);
    END IF;
    action := 'purchase';
    amount := (purchase.receipt->>'savingsKobo')::numeric::bigint;
    transfer := jsonb_build_object('action',action,'operationId',p_operation,'reference',p_operation,
      'sourceWalletId',p_policy->'purchase'->>'sourceWalletId',
      'destinationWalletId',p_policy->'purchase'->>'destinationWalletId',
      'amountKobo',amount,'currency','NGN');
  ELSE
    SELECT * INTO cancellation FROM piggyvest_cancel_plan.intents
      WHERE operation_id=p_operation AND goal_id=p_goal;
    IF NOT FOUND OR cancellation.command->>'revisionId' IS DISTINCT FROM p_policy->>'revisionId' THEN
      RETURN jsonb_build_object('state','deferred','operationId',p_operation);
    END IF;
    action := 'cancellation';
    fee := (p_policy->'cancellation'->>'feeKobo')::numeric::bigint;
    amount := (cancellation.command->>'principalKobo')::numeric::bigint - fee;
    IF amount <= 0 THEN RETURN jsonb_build_object('state','deferred','operationId',p_operation); END IF;
    transfer := jsonb_build_object('action',action,'operationId',p_operation,'reference',p_operation,
      'sourceWalletId',p_policy->'cancellation'->>'sourceWalletId',
      'destinationWalletId',p_policy->'cancellation'->>'destinationWalletId',
      'amountKobo',amount,'currency','NGN');
  END IF;
  INSERT INTO piggyvest_savings_exit_execution.operations(
    operation_id,integration_id,merchant_id,customer_id,goal_id,actor_id,action,policy,transfer,state
  ) VALUES(p_operation,p_integration,p_merchant,p_customer,p_goal,p_actor,action,p_policy,transfer,'verify');
  RETURN jsonb_build_object('state','submit','operationId',p_operation,'transfer',transfer);
END $$;

CREATE FUNCTION piggyvest_savings_exit_execution.record_finality(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text,
  p_actor uuid, p_operation uuid, p_finality jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE saved piggyvest_savings_exit_execution.operations%ROWTYPE;
  settlement uuid; posting jsonb;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed'
    OR session_user <> 'piggyvest_staging_policy_writer'
    OR inet_client_addr() IS NOT NULL OR current_database() <> 'piggyvest_local'
    OR p_finality IS NULL OR jsonb_typeof(p_finality) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_finality)) <> 8
    OR NOT p_finality ?& ARRAY['action','operationId','reference','sourceWalletId','destinationWalletId','amountKobo','currency','status']
    OR p_finality->>'status' NOT IN ('success','pending','failed','unknown') THEN
    RAISE EXCEPTION 'savings exit finality denied' USING ERRCODE = '42501';
  END IF;
  PERFORM piggyvest_goal_policy.lock_scope(p_integration,p_merchant,p_customer,p_goal,p_business);
  IF p_actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.customers customer
    WHERE customer.id=p_customer AND customer.merchant_id=p_merchant AND customer.user_id=p_actor
  ) OR NOT EXISTS(
    SELECT 1 FROM piggyvest_savings_ledger.bindings binding
    WHERE binding.integration_id=p_integration AND binding.merchant_id=p_merchant
      AND binding.customer_id=p_customer AND binding.goal_id=p_goal
      AND binding.authorized_login=session_user AND binding.enabled
  ) THEN
    RAISE EXCEPTION 'savings exit scope denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO saved FROM piggyvest_savings_exit_execution.operations
    WHERE operation_id=p_operation AND integration_id=p_integration AND merchant_id=p_merchant
      AND customer_id=p_customer AND goal_id=p_goal AND actor_id=p_actor FOR UPDATE;
  IF NOT FOUND OR (saved.transfer || jsonb_build_object('status',p_finality->>'status'))
    IS DISTINCT FROM p_finality THEN
    RAISE EXCEPTION 'savings exit finality conflict' USING ERRCODE = '23505';
  END IF;
  IF saved.state IN ('settled','failed') THEN
    IF saved.finality IS DISTINCT FROM p_finality THEN
      RAISE EXCEPTION 'savings exit terminal conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('state',saved.state,'operationId',saved.operation_id);
  END IF;
  IF p_finality->>'status' IN ('pending','unknown') THEN
    RETURN jsonb_build_object('state','pending','operationId',saved.operation_id);
  END IF;
  IF p_finality->>'status' = 'failed' THEN
    UPDATE piggyvest_savings_exit_execution.operations
      SET state='failed',finality=p_finality,finalized_at=clock_timestamp()
      WHERE operation_id=saved.operation_id;
    RETURN jsonb_build_object('state','failed','operationId',saved.operation_id);
  END IF;
  settlement := (substr(md5(saved.operation_id::text || ':settle'),1,8) || '-' ||
    substr(md5(saved.operation_id::text || ':settle'),9,4) || '-4' ||
    substr(md5(saved.operation_id::text || ':settle'),14,3) || '-8' ||
    substr(md5(saved.operation_id::text || ':settle'),18,3) || '-' ||
    substr(md5(saved.operation_id::text || ':settle'),21,12))::uuid;
  PERFORM piggyvest_savings_ledger.apply(p_integration,p_merchant,p_customer,p_goal,
    jsonb_build_object('operationId',settlement,'kind','settle_reservation',
      'principalKobo',0,'interestKobo',0,'evidenceId','savings-exit:'||saved.operation_id::text,
      'referenceId',saved.operation_id));
  posting := jsonb_build_object('kind',CASE WHEN saved.action='purchase' THEN 'purchase_order' ELSE 'cancellation_refund' END,
    'operationId',saved.operation_id,'settlementOperationId',settlement,'transfer',saved.transfer,
    'feeKobo',CASE WHEN saved.action='cancellation' THEN saved.policy->'cancellation'->'feeKobo' ELSE 0 END);
  UPDATE piggyvest_savings_exit_execution.operations
    SET state='settled',finality=p_finality,settlement_operation_id=settlement,
      canonical_posting=posting,finalized_at=clock_timestamp()
    WHERE operation_id=saved.operation_id;
  RETURN jsonb_build_object('state','settled','operationId',saved.operation_id);
END $$;

REVOKE ALL ON FUNCTION piggyvest_savings_exit_execution.valid_policy(jsonb),
  piggyvest_savings_exit_execution.begin(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb),
  piggyvest_savings_exit_execution.record_finality(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON SCHEMA piggyvest_savings_exit_execution IS
  'Local-only durable execution for prepared PiggyVest purchases and cancellations. A policy snapshot is required; no default refund, interest, fee, shortfall, or provider economics exists. Unknown transport stays verification-only. Confirmed finality atomically settles the existing ledger reservation and writes a parent-owned canonical order/refund projection. This migration neither grants runtime access nor activates provider transfers.';

COMMIT;
