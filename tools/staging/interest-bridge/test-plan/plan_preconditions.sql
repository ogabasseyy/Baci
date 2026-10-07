CREATE FUNCTION pg_temp.plan_preconditions(payload jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE entry record;
BEGIN
  IF current_database()<>'postgres' OR session_user<>'postgres' OR inet_client_addr() IS NOT NULL
    OR current_setting('transaction_isolation')<>'read committed'
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM payload->>'systemIdentifier'
    OR clock_timestamp()>=(payload->>'expiresAt')::timestamptz
    OR (payload->>'expiresAt')::timestamptz<>'2026-10-06T15:59:10Z'::timestamptz
    OR (payload->>'providerRetrievedAt')::timestamptz>clock_timestamp()
    OR (payload->>'providerRetrievedAt')::timestamptz<clock_timestamp()-interval '90 seconds' THEN
    RAISE EXCEPTION 'test plan physical identity or fresh evidence refused';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pvb-empty-interest-staging-20261002-v1',0));
  FOR entry IN SELECT namespace,relation FROM pg_temp.plan_tables() LOOP
    EXECUTE format('LOCK TABLE %I.%I IN SHARE ROW EXCLUSIVE MODE',entry.namespace,entry.relation);
  END LOOP;
  IF md5(pg_temp.plan_schema()::text) IS DISTINCT FROM payload->>'schemaMd5'
    OR md5(pg_temp.plan_state()::text) IS DISTINCT FROM payload->>'stateMd5' THEN
    RAISE EXCEPTION 'test plan reviewed schema or state drift';
  END IF;
  PERFORM pg_temp.plan_treasury(payload);
  IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE oid=
      'public.create_customer_savings_goal(uuid,uuid,uuid,uuid,text,jsonb,numeric,numeric,numeric,text,time,date,date,text,uuid,timestamptz,timestamptz,timestamptz,timestamptz,numeric,jsonb,text,text)'::regprocedure)
      IS DISTINCT FROM '54329ee7d061c76bd1e7603d8597f7ee'
    OR (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE oid=
      'public.get_customer_savings_feature_settings(uuid,uuid)'::regprocedure)
      IS DISTINCT FROM '2ce0c402532215657dc8e09492c57856' THEN
    RAISE EXCEPTION 'test plan official RPC contract drift';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=(payload->>'customerId')::uuid
      AND merchant_id=(payload->>'merchantId')::uuid AND user_id=(payload->>'actorId')::uuid
      AND deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=(payload->>'actorId')::uuid AND deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.customer_savings_goals WHERE id=(payload->>'oldGoalId')::uuid
      AND customer_id=(payload->>'customerId')::uuid AND merchant_id=(payload->>'merchantId')::uuid
      AND current_amount=100)
    OR NOT EXISTS(SELECT 1 FROM piggyvest_staging.integrations WHERE id=(payload->>'integrationId')::uuid
      AND enabled AND expected_provider_account_id=payload->>'businessId')
    OR NOT EXISTS(SELECT 1 FROM piggyvest_staging.wallet_goal_mappings
      WHERE goal_id=(payload->>'oldGoalId')::uuid AND integration_id=(payload->>'integrationId')::uuid
      AND merchant_id=(payload->>'merchantId')::uuid AND customer_id=(payload->>'customerId')::uuid
      AND provider_wallet_id='01M3CQX27G9687EFSF1TKYMPR9'
      AND provider_customer_id=payload->>'webhookCustomerId') THEN
    RAISE EXCEPTION 'test plan owner or historical binding refused';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM piggyvest_savings_ledger.bindings
      WHERE goal_id=(payload->>'oldGoalId')::uuid AND integration_id=(payload->>'integrationId')::uuid
      AND merchant_id=(payload->>'merchantId')::uuid AND customer_id=(payload->>'customerId')::uuid
      AND authorized_login='prefunded_treasury_operator' AND enabled)
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_treasury_operator' AND rolcanlogin
      AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
      AND rolvaliduntil>=(payload->>'expiresAt')::timestamptz)
    OR (SELECT count(*) FROM pg_auth_members WHERE member='prefunded_treasury_operator'::regrole
      OR roleid='prefunded_treasury_operator'::regrole)<>2
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE
      (member='prefunded_treasury_operator'::regrole OR roleid='prefunded_treasury_operator'::regrole)
      AND NOT(member='prefunded_treasury_operator'::regrole
        AND pg_get_userbyid(roleid) IN ('prefunded_treasury_ledger_worker','prefunded_card_authorization_reader')
        AND pg_get_userbyid(grantor)='supabase_admin' AND NOT admin_option AND NOT inherit_option AND set_option))
    OR NOT has_function_privilege('prefunded_treasury_operator',
      'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)','EXECUTE')
    OR has_table_privilege('prefunded_treasury_operator','piggyvest_savings_ledger.interest_policies','SELECT')
    OR has_function_privilege('prefunded_treasury_operator',
      'piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)','EXECUTE')
    OR has_function_privilege('prefunded_treasury_operator',
      'piggyvest_savings_ledger.apply_bound(uuid,uuid,uuid,uuid,jsonb)','EXECUTE')
    OR has_table_privilege('authenticated','piggyvest_staging.wallet_goal_mappings','INSERT') THEN
    RAISE EXCEPTION 'test plan restricted binding refused';
  END IF;
  IF (SELECT count(*) FROM public.customer_savings_goals
      WHERE metadata->>'stagingTestPlanKey'=payload->>'planKey')>1 THEN
    RAISE EXCEPTION 'test plan idempotency cardinality refused';
  END IF;
END $$;
