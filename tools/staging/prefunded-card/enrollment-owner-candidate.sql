\set ON_ERROR_STOP on
\if :{?enrollment_owner_test}
\else
  \set enrollment_owner_test off
\endif
\if :{?enrollment_owner_system}
\else
  \set enrollment_owner_system 7685292944002592802
\endif
\if :{?enrollment_owner_fail_after_route}
\else
  \set enrollment_owner_fail_after_route off
\endif
\if :{?enrollment_owner_integration}
\else
  \set enrollment_owner_integration d91d9e87-8e0d-44de-9b84-1e1d709633d2
\endif
\if :{?enrollment_owner_business}
\else
  \set enrollment_owner_business 01M2381RG34HQJMHQKE7DWDACR
\endif
\if :{?enrollment_owner_merchant}
\else
  \set enrollment_owner_merchant 10000000-0000-4000-8000-000000000001
\endif
\if :{?enrollment_owner_customer}
\else
  \set enrollment_owner_customer 10000000-0000-4000-8000-000000000002
\endif
\if :{?enrollment_owner_goal}
\else
  \set enrollment_owner_goal 430314fd-cd8b-4579-98d4-e9f345713dd6
\endif
\if :{?enrollment_owner_wallet}
\else
  \set enrollment_owner_wallet 01M3CQX27G9687EFSF1TKYMPR9
\endif
\if :{?enrollment_owner_provider_customer}
\else
  \set enrollment_owner_provider_customer c096507d-dc32-45d2-9c01-871a27abfd10
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SELECT set_config('baci.enrollment_owner_test', :'enrollment_owner_test', true),
  set_config('baci.enrollment_owner_system', :'enrollment_owner_system', true),
  set_config('baci.enrollment_owner_fail_after_route', :'enrollment_owner_fail_after_route', true);
SELECT pg_advisory_xact_lock(hashtextextended(
  'prefunded-card-legacy-route:' || :'enrollment_owner_goal', 0));
LOCK TABLE public.customer_savings_contributions, piggyvest_staging.goal_inflow_projections,
  public.piggyvest_inflow_credits, piggyvest_savings_ledger.operations,
  piggyvest_savings_ledger.postings, prefunded_card.bank_projections,
  prefunded_card.provider_evidence, prefunded_card.credit_routes IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE enrollment_owner_result(outcome text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE enrollment_owner_scope(
  integration_id uuid NOT NULL,
  business_id text NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  wallet_id text NOT NULL,
  provider_customer_id text NOT NULL
) ON COMMIT DROP;
INSERT INTO enrollment_owner_scope VALUES(
  :'enrollment_owner_integration'::uuid, :'enrollment_owner_business', :'enrollment_owner_merchant'::uuid,
  :'enrollment_owner_customer'::uuid, :'enrollment_owner_goal'::uuid, :'enrollment_owner_wallet',
  :'enrollment_owner_provider_customer'
);

DO $owner$
DECLARE
  observed_system text;
  contribution_count bigint;
  contribution_total bigint;
  reconciled_count bigint;
  route_count bigint;
  route_matches boolean;
  scope enrollment_owner_scope%ROWTYPE;
BEGIN
  SELECT * INTO STRICT scope FROM enrollment_owner_scope;
  observed_system := (SELECT system_identifier::text FROM pg_catalog.pg_control_system());
  IF current_setting('baci.enrollment_owner_test', true) = 'on' THEN
    IF current_database() NOT LIKE 'piggyvest_legacy_enrollment_scratch%'
      OR observed_system = '7685292944002592802'
      OR current_setting('baci.enrollment_owner_system', true) IS DISTINCT FROM observed_system
      OR current_user <> session_user
      OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = session_user AND rolsuper)
      OR current_setting('baci.enrollment_owner_fail_after_route', true) NOT IN ('on', 'off') THEN
      RAISE EXCEPTION 'legacy route owner execution refused' USING ERRCODE = '55000';
    END IF;
  ELSIF current_database() <> 'postgres'
    OR session_user <> 'postgres'
    OR current_user <> 'postgres'
    OR inet_client_addr() IS NOT NULL
    OR observed_system <> '7685292944002592802'
    OR clock_timestamp() >= to_timestamp(1790697550)
    OR scope.integration_id <> 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'::uuid
    OR scope.business_id <> '01M2381RG34HQJMHQKE7DWDACR'
    OR scope.merchant_id <> '10000000-0000-4000-8000-000000000001'::uuid
    OR scope.customer_id <> '10000000-0000-4000-8000-000000000002'::uuid
    OR scope.goal_id <> '430314fd-cd8b-4579-98d4-e9f345713dd6'::uuid
    OR scope.wallet_id <> '01M3CQX27G9687EFSF1TKYMPR9'
    OR scope.provider_customer_id <> 'c096507d-dc32-45d2-9c01-871a27abfd10'
    OR current_setting('baci.enrollment_owner_fail_after_route', true) <> 'off' THEN
    RAISE EXCEPTION 'legacy route production identity or lease refused' USING ERRCODE = '55000';
  END IF;

  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id = scope.integration_id
      AND registry.expected_provider_account_id = scope.business_id
      AND registry.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy route integration refused' USING ERRCODE = '23503'; END IF;
  PERFORM integration_id FROM prefunded_card.evidence_authorities
    WHERE integration_id=scope.integration_id AND business_id=scope.business_id
      AND system_identifier=observed_system AND ingestion_login='prefunded_evidence'
      AND reader_login='prefunded_treasury_operator' AND currency='NGN' AND enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy route evidence authority refused' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM (VALUES
      ('prefunded_card.apply_verified_legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)',
       '0f59fdb22e654778acc08ed590258c5279d4501ef2f5f6d18fdb2221caf6bf36'),
      ('prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)',
       '5d723cbb4bae07bf36f091878e62543a8749f4987285983bc0953df0055edd14'),
      ('public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)',
       'f90b62e80e5fcf8491fa1ae34b105a91362231c4befc07aff998fb1bedacca79')
    ) expected(signature,digest) LEFT JOIN pg_proc routine ON routine.oid=to_regprocedure(expected.signature)
    WHERE routine.oid IS NULL OR routine.proowner IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=session_user)
      OR NOT routine.prosecdef OR routine.proisstrict OR routine.prokind<>'f' OR routine.provolatile<>'v'
      OR routine.prorettype<>'text'::regtype OR routine.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected.digest) THEN
    RAISE EXCEPTION 'legacy route function baseline refused' USING ERRCODE='55000';
  END IF;
  PERFORM goal.id FROM public.customer_savings_goals goal
    JOIN public.customers customer ON customer.id = goal.customer_id AND customer.merchant_id = goal.merchant_id
    JOIN piggyvest_staging.wallet_goal_mappings mapping ON mapping.goal_id = goal.id
      AND mapping.customer_id = goal.customer_id AND mapping.merchant_id = goal.merchant_id
      AND mapping.integration_id = scope.integration_id
    JOIN piggyvest_savings_ledger.bindings binding ON binding.goal_id = goal.id
      AND binding.customer_id = goal.customer_id AND binding.merchant_id = goal.merchant_id
      AND binding.integration_id = mapping.integration_id
    WHERE goal.id = scope.goal_id
      AND goal.merchant_id = scope.merchant_id
      AND goal.customer_id = scope.customer_id
      AND goal.goal_kind = 'legacy' AND goal.source_mode = 'manual' AND goal.status = 'active'
      AND goal.completed_at IS NULL AND goal.cancelled_at IS NULL AND goal.spent_at IS NULL
      AND mapping.provider_wallet_id = scope.wallet_id
      AND mapping.provider_customer_id = scope.provider_customer_id
      AND binding.enabled AND binding.authorized_login = 'prefunded_treasury_operator'
    FOR UPDATE OF goal, customer, mapping, binding;
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy route scope refused' USING ERRCODE = '23514'; END IF;

  PERFORM treasury.id FROM prefunded_card.treasury_bindings treasury
    JOIN prefunded_card.treasury_identities identity ON identity.treasury_binding_id = treasury.id
    WHERE treasury.id = 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'::uuid
      AND treasury.integration_id = scope.integration_id
      AND treasury.merchant_id = scope.merchant_id
      AND treasury.expected_business_id = scope.business_id
      AND treasury.source_wallet_id = '01M238A0V75387H4HZ15YFWGX3'
      AND treasury.currency = 'NGN' AND treasury.verified_available_kobo = 10000
      AND treasury.reserved_kobo = 0 AND treasury.consumed_kobo = 0
      AND treasury.authorized_login = 'prefunded_treasury_operator' AND treasury.enabled
      AND identity.integration_id = treasury.integration_id AND identity.merchant_id = treasury.merchant_id
      AND identity.expected_business_id = treasury.expected_business_id
      AND identity.source_wallet_id = treasury.source_wallet_id
      AND identity.authorized_login = treasury.authorized_login AND identity.opening_available_kobo = 10000
    FOR UPDATE OF treasury FOR SHARE OF identity;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM piggyvest_staging.wallet_goal_mappings
      WHERE provider_wallet_id = '01M238A0V75387H4HZ15YFWGX3') THEN
    RAISE EXCEPTION 'legacy route treasury scope refused' USING ERRCODE = '23514';
  END IF;

  PERFORM contribution.id FROM public.customer_savings_contributions contribution
    WHERE contribution.goal_id = scope.goal_id FOR UPDATE;
  PERFORM projection.provider_transaction_id FROM piggyvest_staging.goal_inflow_projections projection
    WHERE projection.goal_id = scope.goal_id FOR SHARE;
  PERFORM operation.id FROM piggyvest_savings_ledger.operations operation
    WHERE operation.goal_id = scope.goal_id FOR SHARE;
  PERFORM projection.provider_transaction_id FROM prefunded_card.bank_projections projection
    WHERE projection.goal_id = scope.goal_id FOR SHARE;

  SELECT count(*), coalesce(sum(contribution.amount * 100), 0)
    INTO contribution_count, contribution_total
    FROM public.customer_savings_contributions contribution
    WHERE contribution.goal_id = scope.goal_id;
  IF contribution_count <> 1 OR contribution_total <> 10000
    OR (SELECT current_amount * 100 FROM public.customer_savings_goals
        WHERE id = scope.goal_id) <> 10000 THEN
    RAISE EXCEPTION 'needs-history-reconciliation' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO reconciled_count
  FROM enrollment_owner_scope owner_scope
  JOIN piggyvest_staging.goal_inflow_projections legacy ON true
  JOIN public.customer_savings_contributions contribution ON contribution.id = legacy.contribution_id
  JOIN public.piggyvest_inflow_credits credit ON credit.provider_transaction_id = legacy.provider_transaction_id
  JOIN prefunded_card.bank_projections bank ON bank.contribution_id = contribution.id
    AND bank.operation_id = md5('legacy-opening-v1:' || owner_scope.integration_id::text || ':' || legacy.provider_transaction_id)::uuid
  JOIN piggyvest_savings_ledger.operations operation ON operation.id = bank.operation_id
  JOIN prefunded_card.provider_evidence evidence ON evidence.integration_id = bank.integration_id
    AND evidence.event_id = bank.event_id
  WHERE legacy.integration_id = owner_scope.integration_id
    AND legacy.merchant_id = owner_scope.merchant_id
    AND legacy.customer_id = owner_scope.customer_id
    AND legacy.goal_id = owner_scope.goal_id
    AND legacy.provider_wallet_id = owner_scope.wallet_id
    AND legacy.provider_customer_id = owner_scope.provider_customer_id
    AND contribution.merchant_id = legacy.merchant_id AND contribution.customer_id = legacy.customer_id
    AND contribution.goal_id = legacy.goal_id AND contribution.source_type = 'piggyvest_inflow'
    AND contribution.status = 'completed' AND contribution.amount * 100 = legacy.amount_kobo
    AND contribution.idempotency_key = 'piggyvest:' || legacy.provider_transaction_id
    AND credit.customer_id = legacy.provider_customer_id AND credit.wallet_id = legacy.provider_wallet_id
    AND credit.event_data_id = legacy.event_data_id AND credit.event_id = legacy.event_id
    AND credit.amount_kobo = legacy.amount_kobo AND credit.fee_kobo = legacy.fee_kobo
    AND credit.reference = legacy.reference AND credit.session_id IS NOT DISTINCT FROM legacy.session_id
    AND credit.credited_at = legacy.credited_at
    AND bank.integration_id = legacy.integration_id AND bank.merchant_id = legacy.merchant_id
    AND bank.customer_id = legacy.customer_id AND bank.goal_id = legacy.goal_id
    AND bank.provider_transaction_id = evidence.observation ->> 'providerTransactionId'
    AND bank.amount_kobo = legacy.amount_kobo
    AND operation.integration_id = legacy.integration_id AND operation.merchant_id = legacy.merchant_id
    AND operation.customer_id = legacy.customer_id AND operation.goal_id = legacy.goal_id
    AND operation.command ->> 'kind' = 'credit_principal'
    AND operation.command ->> 'principalKobo' = legacy.amount_kobo::text
    AND operation.command ->> 'evidenceId' = 'legacy-opening-v1:' || operation.id::text
    AND evidence.business_id = owner_scope.business_id
    AND evidence.ingestion_login = session_user AND NOT evidence.conflicted
    AND evidence.observation ->> 'status' = 'verified'
    AND evidence.observation ->> 'kind' = 'bank_inflow'
    AND evidence.observation ->> 'eventId' = legacy.event_id
    AND evidence.observation ->> 'destinationWalletId' = legacy.provider_wallet_id
    AND evidence.observation ->> 'destinationCustomerId' = legacy.provider_customer_id
    AND evidence.observation ->> 'amountKobo' = legacy.amount_kobo::text
    AND evidence.observation ->> 'feeKobo' = '0'
    AND evidence.observation ->> 'eventDataId' = legacy.event_data_id
    AND evidence.observation ->> 'reference' = legacy.reference
    AND evidence.observation ->> 'sessionId' IS NOT DISTINCT FROM legacy.session_id
    AND (evidence.observation ->> 'creditedAt')::timestamptz = legacy.credited_at
    AND (SELECT count(*) FROM piggyvest_savings_ledger.postings posting
         WHERE posting.operation_id = operation.id) = 2
    AND (SELECT amount_kobo FROM piggyvest_savings_ledger.postings posting
         WHERE posting.operation_id = operation.id AND posting.account = 'principal') = legacy.amount_kobo
    AND (SELECT amount_kobo FROM piggyvest_savings_ledger.postings posting
         WHERE posting.operation_id = operation.id AND posting.account = 'internal_clearing') = -legacy.amount_kobo;

  IF reconciled_count <> contribution_count
    OR (SELECT count(*) FROM piggyvest_staging.goal_inflow_projections
        WHERE goal_id = scope.goal_id) <> contribution_count
    OR (SELECT count(*) FROM prefunded_card.bank_projections
        WHERE goal_id = scope.goal_id) <> contribution_count
    OR (SELECT count(*) FROM public.piggyvest_inflow_credits credit
        WHERE credit.customer_id = scope.provider_customer_id AND credit.wallet_id = scope.wallet_id) <> contribution_count
    OR (SELECT count(*) FROM prefunded_card.provider_evidence evidence
        WHERE evidence.integration_id = scope.integration_id AND NOT evidence.conflicted
          AND evidence.observation ->> 'status' = 'verified'
          AND evidence.observation ->> 'kind' = 'bank_inflow'
          AND evidence.observation ->> 'destinationWalletId' = scope.wallet_id
          AND evidence.observation ->> 'destinationCustomerId' = scope.provider_customer_id) <> contribution_count
    OR (SELECT count(*) FROM piggyvest_savings_ledger.operations
        WHERE integration_id = scope.integration_id AND goal_id = scope.goal_id) <> contribution_count
    OR (SELECT coalesce(sum(posting.amount_kobo), 0) FROM piggyvest_savings_ledger.postings posting
        JOIN piggyvest_savings_ledger.operations operation ON operation.id = posting.operation_id
        WHERE operation.integration_id = scope.integration_id AND operation.goal_id = scope.goal_id
          AND posting.account = 'principal') <> contribution_total
    OR EXISTS(SELECT 1 FROM prefunded_card.operations operation
        WHERE operation.goal_id = scope.goal_id) THEN
    RAISE EXCEPTION 'legacy canonical projection set refused' USING ERRCODE = '23514';
  END IF;

  SELECT count(*), bool_and(route.integration_id = scope.integration_id
    AND route.merchant_id = scope.merchant_id AND route.customer_id = scope.customer_id
    AND route.system_identifier = observed_system)
    INTO route_count, route_matches
    FROM prefunded_card.credit_routes route
    WHERE route.goal_id = scope.goal_id;
  IF route_count = 1 AND route_matches THEN
    INSERT INTO enrollment_owner_result VALUES ('already_enrolled');
  ELSIF route_count = 0 THEN
    INSERT INTO prefunded_card.credit_routes(goal_id,integration_id,merchant_id,customer_id,system_identifier)
    VALUES(scope.goal_id,scope.integration_id,scope.merchant_id,scope.customer_id,observed_system);
    IF current_setting('baci.enrollment_owner_fail_after_route', true) = 'on' THEN
      RAISE EXCEPTION 'legacy route rehearsal rollback' USING ERRCODE = 'P0001';
    END IF;
    IF clock_timestamp() >= to_timestamp(1790697550)
      AND current_setting('baci.enrollment_owner_test', true) <> 'on' THEN
      RAISE EXCEPTION 'legacy route owner lease expired before commit' USING ERRCODE = '55000';
    END IF;
    INSERT INTO enrollment_owner_result VALUES ('enrolled');
  ELSE
    RAISE EXCEPTION 'legacy route existing scope refused' USING ERRCODE = '23514';
  END IF;
END
$owner$;
SELECT outcome FROM enrollment_owner_result;
COMMIT;
