BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
SET LOCAL synchronous_commit=on;
SET LOCAL password_encryption='scram-sha-256';
SELECT pg_advisory_xact_lock(170923,10000);
LOCK TABLE prefunded_card.credit_routes IN SHARE MODE;
CREATE TEMP TABLE treasury_owner_input(value jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO treasury_owner_input VALUES (__OWNER_INPUT__::jsonb);

DO $$
DECLARE input jsonb; executor pg_roles%ROWTYPE;
BEGIN
  SELECT value INTO STRICT input FROM treasury_owner_input;
  IF current_user<>session_user OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=session_user)
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM input->>'systemIdentifier'
    OR current_database()<>'postgres' OR clock_timestamp()>=(input->>'expiresAt')::timestamptz
    OR (input->>'verifiedAt')::timestamptz NOT BETWEEN clock_timestamp()-interval '30 seconds' AND clock_timestamp()
    OR (input->>'openingAvailableKobo')::bigint<>10000
    OR input->>'verifierPassword' !~ '^[A-Za-z0-9_-]{64}$'
    OR (SELECT count(*) FROM jsonb_object_keys(input))<>10 THEN
    RAISE EXCEPTION 'treasury owner input refused';
  END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.credit_routes) THEN
    RAISE EXCEPTION 'existing credit routes refused before treasury provisioning';
  END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.treasury_bindings)
    OR to_regclass('prefunded_card.treasury_verifier_bindings') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_snapshot_verifier') THEN
    RAISE EXCEPTION 'treasury already provisioned or partial; inspect before retry';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id=(input->>'integrationId')::uuid AND registry.enabled
      AND registry.expected_provider_account_id=input->>'businessId' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'treasury provider registry refused'; END IF;
  PERFORM mapping.goal_id FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id
      AND customer.merchant_id=mapping.merchant_id
    JOIN public.customer_savings_goals goal ON goal.id=mapping.goal_id
      AND goal.customer_id=mapping.customer_id AND goal.merchant_id=mapping.merchant_id
    JOIN piggyvest_savings_ledger.bindings binding ON binding.integration_id=mapping.integration_id
      AND binding.merchant_id=mapping.merchant_id AND binding.customer_id=mapping.customer_id
      AND binding.goal_id=mapping.goal_id
    WHERE mapping.integration_id=(input->>'integrationId')::uuid
      AND mapping.merchant_id=(input->>'merchantId')::uuid AND binding.enabled
      AND binding.authorized_login='prefunded_treasury_operator' AND goal.status='active'
      AND goal.completed_at IS NULL AND goal.cancelled_at IS NULL AND goal.spent_at IS NULL
    FOR SHARE OF mapping,customer,goal,binding;
  IF NOT FOUND THEN RAISE EXCEPTION 'treasury merchant mapping refused'; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_staging.wallet_goal_mappings
      WHERE provider_wallet_id=input->>'sourceWalletId') THEN
    RAISE EXCEPTION 'treasury is not the approved separate business wallet';
  END IF;
  SELECT * INTO executor FROM pg_roles WHERE rolname='prefunded_treasury_operator';
  IF NOT FOUND OR executor.rolcanlogin OR executor.rolsuper OR executor.rolbypassrls
    OR executor.rolcreaterole OR executor.rolcreatedb OR executor.rolreplication OR executor.rolinherit
    OR NOT pg_has_role(executor.oid,'prefunded_treasury_ledger_worker','MEMBER') THEN
    RAISE EXCEPTION 'treasury operator baseline refused';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_treasury_provisioner') THEN
    CREATE ROLE prefunded_treasury_provisioner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_treasury_verifier') THEN
    CREATE ROLE prefunded_treasury_verifier NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('prefunded_treasury_provisioner','prefunded_treasury_verifier')
    AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
    RAISE EXCEPTION 'unsafe treasury capability roles';
  END IF;
  CREATE ROLE prefunded_snapshot_verifier LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  EXECUTE format('ALTER ROLE prefunded_snapshot_verifier PASSWORD %L VALID UNTIL %L',
    input->>'verifierPassword',input->>'expiresAt');
  GRANT prefunded_treasury_verifier TO prefunded_snapshot_verifier WITH INHERIT FALSE, SET FALSE;
  PERFORM prefunded_card.provision_treasury_identity((input->>'treasuryBindingId')::uuid,
    (input->>'integrationId')::uuid,(input->>'merchantId')::uuid,input->>'businessId',
    input->>'sourceWalletId','prefunded_treasury_operator',(input->>'openingAvailableKobo')::bigint);
END $$;

__SNAPSHOT_SQL__

INSERT INTO prefunded_card.treasury_verifier_bindings(login_name,treasury_binding_id,system_identifier,expires_at)
SELECT 'prefunded_snapshot_verifier',(value->>'treasuryBindingId')::uuid,value->>'systemIdentifier',
  (value->>'expiresAt')::timestamptz FROM treasury_owner_input;
DO $$ BEGIN
  IF clock_timestamp()>=(SELECT (value->>'expiresAt')::timestamptz FROM treasury_owner_input)
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN
      ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence') AND rolcanlogin) THEN
    RAISE EXCEPTION 'treasury postflight refused';
  END IF;
END $$;
COMMIT;
