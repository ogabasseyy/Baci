BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'guards',(SELECT jsonb_agg(jsonb_build_object('signature',routine.oid::regprocedure::text,
    'definitionMd5',md5(pg_get_functiondef(routine.oid))))
    FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
    WHERE namespace.nspname='public' AND routine.proname IN
      ('enforce_customer_savings_goal_variant','enforce_customer_savings_finite_money')),
  'memberships',(SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),
    'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),
    'admin',admin_option,'inherit',inherit_option,'set',set_option))
    FROM pg_auth_members WHERE member='prefunded_treasury_operator'::regrole
      OR roleid='prefunded_treasury_operator'::regrole),
  'roleInherit',(SELECT rolinherit FROM pg_roles WHERE rolname='prefunded_treasury_operator'),
  'directApply',has_function_privilege('prefunded_treasury_operator',
    'piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)','EXECUTE'),
  'directApplyBound',has_function_privilege('prefunded_treasury_operator',
    'piggyvest_savings_ledger.apply_bound(uuid,uuid,uuid,uuid,jsonb)','EXECUTE'));
ROLLBACK;
