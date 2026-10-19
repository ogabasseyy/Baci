BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SET LOCAL synchronous_commit=on;
SET LOCAL search_path=pg_catalog;
SELECT pg_advisory_xact_lock(1791302350);
__TIME_GUARD__
LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE pg_catalog.pg_auth_members,pg_catalog.pg_proc,pg_catalog.pg_namespace,
  pg_catalog.pg_class,pg_catalog.pg_database IN SHARE MODE;
LOCK TABLE public.customer_savings_goals,public.customers,public.push_tokens,
  public.customer_savings_contributions,savings_notifications.preferences,savings_notifications.events,
  savings_notifications.deliveries,piggyvest_savings_ledger.bindings,piggyvest_savings_ledger.operations,
  piggyvest_savings_ledger.postings,piggyvest_savings_ledger.interest_allocations,
  piggyvest_savings_ledger.interest_receipts,prefunded_card.treasury_bindings,
  prefunded_card.operations,prefunded_card.checkout_intents IN SHARE MODE;
__ROLE_GUARD__
CREATE TEMP TABLE notification_scope_before ON COMMIT DROP AS __STATE_QUERY__;
DO $$ DECLARE observed jsonb; BEGIN
  SELECT value INTO STRICT observed FROM notification_scope_before;
  IF observed @> '__EXPECTED_STATE__'::jsonb IS DISTINCT FROM true
    OR observed->'routines' IS DISTINCT FROM '__EXPECTED_ROUTINES__'::jsonb THEN
    RAISE EXCEPTION 'notification renewal protected baseline refused' USING ERRCODE='42501';
  END IF;
END $$;
CREATE FUNCTION pg_temp.notification_protected_state() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'roles',(SELECT jsonb_agg(CASE WHEN rolname='baci_savings_notifications_worker'
      THEN to_jsonb(role)-'rolvaliduntil' ELSE to_jsonb(role) END ORDER BY oid) FROM pg_authid role),
    'members',(SELECT jsonb_agg(to_jsonb(member) ORDER BY roleid,member,grantor) FROM pg_auth_members member),
    'routines',(SELECT jsonb_agg(to_jsonb(routine) ORDER BY oid) FROM pg_proc routine
      WHERE pronamespace NOT IN (SELECT oid FROM pg_namespace WHERE nspname LIKE 'pg_temp_%')),
    'schemaAcls',(SELECT jsonb_agg(jsonb_build_array(oid,nspowner,nspacl) ORDER BY oid) FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'),
    'tableAcls',(SELECT jsonb_agg(jsonb_build_array(oid,relowner,relacl) ORDER BY oid) FROM pg_class
      WHERE relnamespace NOT IN (SELECT oid FROM pg_namespace WHERE nspname LIKE 'pg_temp_%'
        OR nspname LIKE 'pg_toast_temp_%')),
    'databaseAcls',(SELECT jsonb_agg(to_jsonb(database) ORDER BY oid) FROM pg_database database),
    'goals',(SELECT jsonb_agg(to_jsonb(goal) ORDER BY id) FROM public.customer_savings_goals goal),
    'customers',(SELECT jsonb_agg(to_jsonb(customer) ORDER BY id) FROM public.customers customer),
    'tokens',(SELECT jsonb_agg(to_jsonb(token) ORDER BY id) FROM public.push_tokens token),
    'contributions',(SELECT jsonb_agg(to_jsonb(contribution) ORDER BY id) FROM public.customer_savings_contributions contribution),
    'preferences',(SELECT jsonb_agg(to_jsonb(preference) ORDER BY merchant_id,customer_id) FROM savings_notifications.preferences preference),
    'events',(SELECT jsonb_agg(to_jsonb(event) ORDER BY id) FROM savings_notifications.events event),
    'deliveries',(SELECT jsonb_agg(to_jsonb(delivery) ORDER BY notification_id,push_token) FROM savings_notifications.deliveries delivery),
    'bindings',(SELECT jsonb_agg(to_jsonb(binding) ORDER BY goal_id) FROM piggyvest_savings_ledger.bindings binding),
    'operations',(SELECT jsonb_agg(to_jsonb(operation) ORDER BY id) FROM piggyvest_savings_ledger.operations operation),
    'postings',(SELECT jsonb_agg(to_jsonb(posting) ORDER BY operation_id,account) FROM piggyvest_savings_ledger.postings posting),
    'allocations',(SELECT jsonb_agg(to_jsonb(allocation) ORDER BY id) FROM piggyvest_savings_ledger.interest_allocations allocation),
    'receipts',(SELECT jsonb_agg(to_jsonb(receipt) ORDER BY allocation_id) FROM piggyvest_savings_ledger.interest_receipts receipt),
    'treasury',(SELECT jsonb_agg(to_jsonb(treasury) ORDER BY id) FROM prefunded_card.treasury_bindings treasury),
    'payments',(SELECT jsonb_agg(to_jsonb(payment) ORDER BY id) FROM prefunded_card.operations payment),
    'checkout',(SELECT jsonb_agg(to_jsonb(checkout) ORDER BY id) FROM prefunded_card.checkout_intents checkout));
$$;
CREATE TEMP TABLE notification_protected_before ON COMMIT DROP AS
  SELECT pg_temp.notification_protected_state() AS value;
ALTER ROLE baci_savings_notifications_worker VALID UNTIL '__NEXT_EXPIRY__';
DO $$ BEGIN
  IF (SELECT value FROM notification_protected_before) IS DISTINCT FROM pg_temp.notification_protected_state()
    OR (SELECT rolvaliduntil FROM pg_roles WHERE rolname='baci_savings_notifications_worker')
      IS DISTINCT FROM '__NEXT_EXPIRY__'::timestamptz THEN
    RAISE EXCEPTION 'notification expiry-only postcondition refused' USING ERRCODE='42501';
  END IF;
END $$;
__FINISH__
