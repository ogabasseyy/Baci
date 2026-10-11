\set ON_ERROR_STOP on
\set QUIET on
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'captured_at',clock_timestamp(),
  'session_is_fixed_login',SESSION_USER='baci_primary_card_custody' AND CURRENT_USER=SESSION_USER,
  'tls',(SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()),
  'login_restricted',NOT login.rolsuper AND NOT login.rolbypassrls AND NOT login.rolcreaterole AND NOT login.rolcreatedb AND NOT login.rolreplication,
  'login_valid_until',login.rolvaliduntil,
  'sole_capability_membership',(SELECT count(*)=1 AND bool_and(parent.rolname='primary_card_custody_evidence')
    FROM pg_catalog.pg_auth_members member JOIN pg_catalog.pg_roles parent ON parent.oid=member.roleid WHERE member.member=login.oid),
  'capability_restricted',NOT capability.rolcanlogin AND NOT capability.rolsuper AND NOT capability.rolbypassrls
    AND NOT capability.rolcreaterole AND NOT capability.rolcreatedb AND NOT capability.rolreplication,
  'capability_parent_memberships',(SELECT count(*) FROM pg_catalog.pg_auth_members WHERE member=capability.oid),
  'schema_usage',has_schema_privilege(SESSION_USER,'piggyvest_primary_card','USAGE'),
  'effective_primary_rpcs',(SELECT coalesce(jsonb_agg(routine.proname||'('||pg_catalog.pg_get_function_identity_arguments(routine.oid)||')' ORDER BY routine.proname),'[]'::jsonb)
    FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
    WHERE namespace.nspname='piggyvest_primary_card' AND has_function_privilege(SESSION_USER,routine.oid,'EXECUTE')),
  'direct_private_table_privileges',(SELECT count(*) FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='piggyvest_primary_card' AND relation.relkind IN ('r','p') AND (
      has_table_privilege(SESSION_USER,relation.oid,'SELECT') OR has_table_privilege(SESSION_USER,relation.oid,'INSERT')
      OR has_table_privilege(SESSION_USER,relation.oid,'UPDATE') OR has_table_privilege(SESSION_USER,relation.oid,'DELETE')
      OR has_table_privilege(SESSION_USER,relation.oid,'TRUNCATE'))),
  'public_custody_rpcs',(SELECT count(*) FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) grant_item
    WHERE namespace.nspname='piggyvest_primary_card' AND routine.proname IN ('transfer_context','settle_custody',
      'signed_inbox_readiness','inbox_ready','enqueue_signed_inbox','claim_signed_inbox',
      'resolve_signed_reference','finish_signed_inbox')
      AND grant_item.grantee=0 AND grant_item.privilege_type='EXECUTE'),
  'custody_rpcs_present',(SELECT count(*)=8 FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
    WHERE namespace.nspname='piggyvest_primary_card'
      AND ((routine.proname='transfer_context' AND routine.proargtypes='2950 25 2950'::oidvector)
        OR (routine.proname IN ('settle_custody','signed_inbox_readiness','inbox_ready') AND routine.proargtypes='2950 25 3802'::oidvector)
        OR (routine.proname='enqueue_signed_inbox' AND routine.proargtypes='2950 25 3802 25 25'::oidvector)
        OR (routine.proname='claim_signed_inbox' AND routine.proargtypes='2950 25 3802 23'::oidvector)
        OR (routine.proname='resolve_signed_reference' AND routine.proargtypes='2950 25 3802 25 25'::oidvector)
        OR (routine.proname='finish_signed_inbox' AND routine.proargtypes='2950 25 3802 25 2950 25'::oidvector))
      AND has_function_privilege(SESSION_USER,routine.oid,'EXECUTE')),
  'customer_or_service_custody_execution',(SELECT count(*) FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
    WHERE namespace.nspname='piggyvest_primary_card' AND routine.proname IN ('transfer_context','settle_custody',
      'signed_inbox_readiness','inbox_ready','enqueue_signed_inbox','claim_signed_inbox',
      'resolve_signed_reference','finish_signed_inbox')
      AND (has_function_privilege('anon',routine.oid,'EXECUTE') OR has_function_privilege('authenticated',routine.oid,'EXECUTE')
        OR has_function_privilege('service_role',routine.oid,'EXECUTE')))) AS restricted_inventory
FROM pg_catalog.pg_roles login JOIN pg_catalog.pg_roles capability ON capability.rolname='primary_card_custody_evidence'
WHERE login.rolname=SESSION_USER;
COMMIT;
-- Readiness probe: the signed-inbox readiness call the worker issues. It takes
-- only the same brief FOR SHARE row locks as the worker's own readiness run,
-- writes nothing, and reports ready only when worker session, inbox
-- capability, settings scope and enabled treasury policy verify.
SELECT jsonb_build_object('exact_enabled_authority_ready',
  ((piggyvest_primary_card.signed_inbox_readiness(:'integration_id'::uuid,'production',jsonb_build_object(
    'contractId',:'contract_id','evidenceIssuer',:'evidence_issuer',
    'treasuryWebhookCustomerId',:'treasury_webhook_customer_id','transactionCustomerId',:'transaction_customer_id',
    'payloadContract',:'payload_contract','mappingContract',:'mapping_contract',
    'merchantId',:'merchant_id','businessId',:'business_id','expiresAt',:'expires_at')->>'ready'))::boolean IS TRUE),
  'financial_actions',false) AS authority_inventory;
