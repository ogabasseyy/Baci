BEGIN;

CREATE TABLE piggyvest_primary.savings_completion_reviews (
  goal_id uuid PRIMARY KEY REFERENCES public.customer_savings_goals(id),
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  pending_operation_ids uuid[] NOT NULL,
  overshoot_kobo numeric NOT NULL CHECK (overshoot_kobo >= 0),
  state text NOT NULL CHECK (state IN ('open','cleared')),
  first_flagged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX primary_completion_review_integration_idx ON piggyvest_primary.savings_completion_reviews(integration_id);
CREATE INDEX primary_completion_review_merchant_idx ON piggyvest_primary.savings_completion_reviews(merchant_id);
CREATE INDEX primary_completion_review_customer_idx ON piggyvest_primary.savings_completion_reviews(customer_id);
ALTER TABLE piggyvest_primary.savings_completion_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_completion_reviews_deny ON piggyvest_primary.savings_completion_reviews
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.savings_completion_reviews FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE piggyvest_primary.savings_completion_evidence (
  operation_id uuid PRIMARY KEY REFERENCES piggyvest_primary.savings_operations(id),
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  provider_transaction_id text NOT NULL,
  proof jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(integration_id,provider_transaction_id)
);
CREATE INDEX primary_completion_evidence_integration_idx ON piggyvest_primary.savings_completion_evidence(integration_id);
ALTER TABLE piggyvest_primary.savings_completion_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_completion_evidence_deny ON piggyvest_primary.savings_completion_evidence
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.savings_completion_evidence FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION piggyvest_primary.completion_totals(p_goal uuid,p_merchant uuid,p_customer uuid)
RETURNS TABLE(integration_id uuid,paid_interest_kobo numeric,pending_kobo numeric,pending_ids uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  WITH destinations AS (
    SELECT integration.id,integration.business_id,integration.environment,intent.id AS intent_id
    FROM piggyvest_primary.savings_destinations destination
    JOIN piggyvest_primary.integrations integration ON integration.id=destination.integration_id
    JOIN piggyvest_primary.onboarding_intents intent ON intent.id=destination.intent_id
      AND intent.integration_id=integration.id AND intent.merchant_id=integration.merchant_id
    JOIN public.customers customer ON customer.id=intent.customer_id
      AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.user_id
    WHERE destination.goal_id=p_goal AND destination.enabled AND integration.enabled
      AND integration.merchant_id=p_merchant AND intent.customer_id=p_customer
      AND intent.state IN ('accepted','verified')
  )
  SELECT destination.id,
    coalesce((SELECT sum(posting.amount_kobo)
      FROM piggyvest_savings_ledger.bindings binding
      JOIN piggyvest_staging.integrations registry ON registry.id=binding.integration_id
      JOIN piggyvest_savings_ledger.operations operation ON operation.integration_id=binding.integration_id
        AND operation.goal_id=binding.goal_id AND operation.merchant_id=binding.merchant_id
        AND operation.customer_id=binding.customer_id
      JOIN piggyvest_savings_ledger.postings posting ON posting.operation_id=operation.id
      WHERE binding.goal_id=p_goal AND binding.merchant_id=p_merchant AND binding.customer_id=p_customer
        AND binding.enabled AND registry.enabled AND destination.environment='staging'
        AND registry.expected_provider_account_id=destination.business_id
        AND posting.account IN ('paid_interest','purchase_interest')),0),
    coalesce((SELECT sum(operation.amount_kobo) FROM piggyvest_primary.savings_operations operation
      WHERE operation.goal_id=p_goal AND operation.integration_id=destination.id
        AND operation.intent_id=destination.intent_id AND operation.state IN ('reserved','dispatched')),0),
    coalesce((SELECT array_agg(operation.id ORDER BY operation.id) FROM piggyvest_primary.savings_operations operation
      WHERE operation.goal_id=p_goal AND operation.integration_id=destination.id
        AND operation.intent_id=destination.intent_id AND operation.state IN ('reserved','dispatched')),'{}'::uuid[])
  FROM destinations destination WHERE (SELECT count(*) FROM destinations)=1;
$$;

CREATE FUNCTION piggyvest_primary.complete_funded_goal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE totals record; funded numeric;
BEGIN
  IF NEW.goal_kind<>'legacy' OR NEW.status NOT IN ('active','paused','completed') THEN RETURN NEW; END IF;
  SELECT * INTO totals FROM piggyvest_primary.completion_totals(NEW.id,NEW.merchant_id,NEW.customer_id);
  IF NOT FOUND THEN RETURN NEW; END IF;
  funded:=NEW.current_amount*100+totals.paid_interest_kobo;
  IF totals.paid_interest_kobo<0 OR NEW.target_amount<=0 THEN RETURN NEW; END IF;
  IF funded>=NEW.target_amount*100 THEN
    NEW.status:='completed';
    NEW.completed_at:=coalesce(OLD.completed_at,clock_timestamp());
  ELSIF OLD.status='completed' OR NEW.status='completed' THEN
    NEW.status:=CASE WHEN OLD.status IN ('active','paused') THEN OLD.status ELSE 'paused' END;
    NEW.completed_at:=NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_primary_paid_interest_completion
  BEFORE UPDATE OF current_amount,target_amount,status ON public.customer_savings_goals
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.complete_funded_goal();

CREATE FUNCTION piggyvest_primary.flag_completion_overshoot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE totals record; overshoot numeric;
BEGIN
  IF NEW.goal_kind<>'legacy' THEN RETURN NEW; END IF;
  SELECT * INTO totals FROM piggyvest_primary.completion_totals(NEW.id,NEW.merchant_id,NEW.customer_id);
  IF NOT FOUND THEN RETURN NEW; END IF;
  overshoot:=greatest(0,NEW.current_amount*100+totals.paid_interest_kobo+totals.pending_kobo-NEW.target_amount*100);
  IF overshoot>0 AND cardinality(totals.pending_ids)>0 THEN
    INSERT INTO piggyvest_primary.savings_completion_reviews
      (goal_id,integration_id,merchant_id,customer_id,pending_operation_ids,overshoot_kobo,state)
    VALUES(NEW.id,totals.integration_id,NEW.merchant_id,NEW.customer_id,totals.pending_ids,overshoot,'open')
    ON CONFLICT(goal_id) DO UPDATE SET pending_operation_ids=excluded.pending_operation_ids,
      overshoot_kobo=excluded.overshoot_kobo,state='open',updated_at=clock_timestamp();
  ELSE
    UPDATE piggyvest_primary.savings_completion_reviews SET state='cleared',overshoot_kobo=0,
      pending_operation_ids=totals.pending_ids,updated_at=clock_timestamp()
      WHERE goal_id=NEW.id AND integration_id=totals.integration_id
        AND merchant_id=NEW.merchant_id AND customer_id=NEW.customer_id AND state='open';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_paid_interest_overshoot
  AFTER UPDATE OF current_amount,target_amount,status ON public.customer_savings_goals
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.flag_completion_overshoot();

CREATE FUNCTION piggyvest_primary.refresh_paid_interest_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE affected record;
BEGIN
  FOR affected IN
    SELECT DISTINCT operation.goal_id,operation.merchant_id,operation.customer_id
    FROM primary_interest_postings posting
    JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id
    WHERE posting.account IN ('paid_interest','purchase_interest')
    ORDER BY operation.goal_id,operation.merchant_id,operation.customer_id
  LOOP
    UPDATE public.customer_savings_goals goal SET status=goal.status
      WHERE goal.id=affected.goal_id AND goal.merchant_id=affected.merchant_id
        AND goal.customer_id=affected.customer_id AND goal.goal_kind='legacy'
        AND EXISTS(SELECT 1 FROM piggyvest_primary.completion_totals(goal.id,goal.merchant_id,goal.customer_id));
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER primary_paid_interest_refresh AFTER INSERT ON piggyvest_savings_ledger.postings
  REFERENCING NEW TABLE AS primary_interest_postings FOR EACH STATEMENT
  EXECUTE FUNCTION piggyvest_primary.refresh_paid_interest_completion();

CREATE FUNCTION piggyvest_primary.refresh_transfer_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  UPDATE public.customer_savings_goals goal SET status=goal.status
    WHERE goal.id=NEW.goal_id AND goal.goal_kind='legacy'
      AND EXISTS(SELECT 1 FROM piggyvest_primary.completion_totals(goal.id,goal.merchant_id,goal.customer_id) totals
        WHERE totals.integration_id=NEW.integration_id);
  RETURN NEW;
END $$;
CREATE TRIGGER primary_transfer_completion_refresh AFTER INSERT OR UPDATE OF state ON piggyvest_primary.savings_operations
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.refresh_transfer_completion();

ALTER FUNCTION piggyvest_primary.settle_savings(uuid,text,jsonb) RENAME TO settle_savings_before_completion;
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)'::regprocedure) INTO definition;
  EXECUTE replace(definition,'settle_savings.','settle_savings_before_completion.');
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,piggyvest_primary_evidence;
CREATE FUNCTION piggyvest_primary.settle_savings(integration_id uuid,environment text,proof jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary.savings_operations%ROWTYPE;
  integration piggyvest_primary.integrations%ROWTYPE;
  totals record;
  principal numeric;
  target numeric;
BEGIN
  SELECT candidate.* INTO integration FROM piggyvest_primary.integrations candidate
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=candidate.id
    WHERE candidate.id=settle_savings.integration_id AND candidate.environment=settle_savings.environment
      AND candidate.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
    FOR SHARE OF candidate,authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement authority unavailable' USING ERRCODE='42501'; END IF;
  SELECT candidate.* INTO operation FROM piggyvest_primary.savings_operations candidate
    WHERE candidate.id=(proof->>'operationId')::uuid AND candidate.integration_id=integration.id;
  IF FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('primary-savings:'||operation.intent_id::text,0));
  END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.savings_completion_evidence saved
    WHERE saved.operation_id=(settle_savings.proof->>'operationId')::uuid AND saved.integration_id=integration.id
      AND saved.proof IS DISTINCT FROM settle_savings.proof) THEN RETURN 'conflict'; END IF;
  BEGIN
    RETURN piggyvest_primary.settle_savings_before_completion(integration_id,environment,proof);
  EXCEPTION WHEN SQLSTATE 'P0001' OR SQLSTATE '42501' THEN
    IF SQLERRM NOT IN ('savings_contribution_exceeds_remaining_target','savings settlement capacity unavailable') THEN RAISE; END IF;
  END;
  SELECT candidate.* INTO operation FROM piggyvest_primary.savings_operations candidate
    WHERE candidate.id=(proof->>'operationId')::uuid AND candidate.integration_id=integration.id;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('primary-savings:'||operation.intent_id::text,0));
  SELECT candidate.* INTO operation FROM piggyvest_primary.savings_operations candidate WHERE candidate.id=operation.id FOR UPDATE;
  IF operation.state<>'dispatched' OR operation.amount_kobo<>(proof->>'amountKobo')::numeric
    OR operation.reference<>proof->>'reference' OR operation.source_wallet_id<>proof->>'sourceWalletId'
    OR operation.destination_wallet_id<>proof->>'destinationWalletId' OR integration.business_id<>proof->>'businessId'
    OR NOT EXISTS(SELECT 1 FROM piggyvest_primary.onboarding_intents intent
      JOIN public.customers customer ON customer.id=intent.customer_id AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.user_id
      JOIN public.customer_savings_goals goal ON goal.id=operation.goal_id AND goal.customer_id=intent.customer_id AND goal.merchant_id=intent.merchant_id
      WHERE intent.id=operation.intent_id AND intent.integration_id=integration.id AND intent.merchant_id=integration.merchant_id
        AND intent.state IN ('accepted','verified') AND intent.provider_wallet_id=operation.source_wallet_id) THEN RETURN 'conflict'; END IF;
  SELECT goal.current_amount*100,goal.target_amount*100 INTO principal,target
    FROM public.customer_savings_goals goal WHERE goal.id=operation.goal_id FOR UPDATE;
  SELECT scoped.* INTO totals FROM public.customer_savings_goals goal
    CROSS JOIN LATERAL piggyvest_primary.completion_totals(goal.id,goal.merchant_id,goal.customer_id) scoped
    WHERE goal.id=operation.goal_id AND scoped.integration_id=integration.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'savings completion review scope unavailable' USING ERRCODE='42501'; END IF;
  IF principal+totals.paid_interest_kobo+totals.pending_kobo<=target THEN
    RAISE EXCEPTION 'savings completion review capacity mismatch' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.savings_operations saved
    WHERE saved.integration_id=integration.id AND saved.provider_transaction_id=proof->>'providerTransactionId' AND saved.id<>operation.id) THEN RETURN 'conflict'; END IF;
  INSERT INTO piggyvest_primary.savings_completion_evidence(operation_id,integration_id,provider_transaction_id,proof)
    VALUES(operation.id,integration.id,settle_savings.proof->>'providerTransactionId',settle_savings.proof) ON CONFLICT DO NOTHING;
  UPDATE public.customer_savings_goals goal SET status=goal.status WHERE goal.id=operation.goal_id;
  RETURN 'conflict';
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.settle_savings(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.settle_savings(uuid,text,jsonb) TO piggyvest_primary_evidence;

ALTER FUNCTION piggyvest_primary.reserve_savings(jsonb,jsonb) RENAME TO reserve_savings_before_interest;
REVOKE ALL ON FUNCTION piggyvest_primary.reserve_savings_before_interest(jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,piggyvest_primary_authorizer;
CREATE FUNCTION piggyvest_primary.reserve_savings(scope jsonb,request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; totals record; principal numeric; target numeric;
BEGIN
  BEGIN
    result:=piggyvest_primary.reserve_savings_before_interest(scope,request);
    IF result->>'status'<>'claimed' THEN RETURN result; END IF;
    SELECT goal.current_amount*100,goal.target_amount*100 INTO principal,target
      FROM public.customer_savings_goals goal WHERE goal.id=(request->>'goalId')::uuid
        AND goal.merchant_id=(scope->>'merchantId')::uuid AND goal.customer_id=(scope->>'customerId')::uuid FOR UPDATE;
    SELECT scoped.* INTO totals FROM piggyvest_primary.completion_totals(
      (request->>'goalId')::uuid,(scope->>'merchantId')::uuid,(scope->>'customerId')::uuid) scoped
      WHERE scoped.integration_id=(scope->>'integrationId')::uuid;
    IF NOT FOUND OR principal+totals.paid_interest_kobo+totals.pending_kobo>target THEN
      RAISE EXCEPTION 'primary paid-interest reservation exceeds capacity' USING ERRCODE='P0001';
    END IF;
    RETURN result;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM<>'primary paid-interest reservation exceeds capacity' THEN RAISE; END IF;
    RETURN jsonb_build_object('status','insufficient');
  END;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.reserve_savings(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.reserve_savings(jsonb,jsonb) TO piggyvest_primary_authorizer;

REVOKE ALL ON FUNCTION piggyvest_primary.completion_totals(uuid,uuid,uuid),
  piggyvest_primary.complete_funded_goal(),piggyvest_primary.flag_completion_overshoot(),
  piggyvest_primary.refresh_paid_interest_completion(),piggyvest_primary.refresh_transfer_completion()
  FROM PUBLIC,anon,authenticated,service_role;

UPDATE public.customer_savings_goals goal SET status=goal.status
WHERE goal.goal_kind='legacy' AND EXISTS(
  SELECT 1 FROM piggyvest_primary.completion_totals(goal.id,goal.merchant_id,goal.customer_id));

COMMIT;
