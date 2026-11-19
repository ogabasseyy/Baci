-- Include-only part of public_definer_function_exposure.sql (no BEGIN/ROLLBACK): the
-- entry point owns the transaction and loads this file with \ir.
--
-- (d) Every function referenced by an RLS policy (public and storage) or by a
-- view runs as the querying role, so that role needs EXECUTE. A SECURITY DEFINER
-- helper added to a policy without an explicit grant would otherwise fail every
-- query on the table with "permission denied for function". Policies TO PUBLIC
-- are checked for anon and authenticated. Plain views are checked for every
-- non-predefined role with table or column SELECT (members of anon/authenticated
-- inherit); a materialized view evaluates its functions only at refresh, as its
-- owner, so the owner is checked. Functions reached only through other functions
-- or other views are not followed.

DO $helpers$
DECLARE
  v_policy_offenders text;
  v_view_offenders text;
BEGIN
  SELECT pg_catalog.string_agg(offender.description, E'\n  ' ORDER BY offender.description)
  INTO v_policy_offenders
  FROM (
    SELECT DISTINCT pg_catalog.format(
      'policy %I on %I.%I (role %s) cannot execute %s',
      policy.polname,
      namespace.nspname,
      relation.relname,
      policy_role.role_name,
      dependency.refobjid::pg_catalog.regprocedure
    ) AS description
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_depend AS dependency
      ON dependency.classid = 'pg_catalog.pg_policy'::pg_catalog.regclass
      AND dependency.objid = policy.oid
      AND dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
    CROSS JOIN LATERAL (
      SELECT role_row.rolname::text AS role_name
      FROM pg_catalog.pg_roles AS role_row
      WHERE role_row.oid = ANY (policy.polroles)
      UNION
      SELECT public_role.role_name
      FROM pg_catalog.unnest(ARRAY['anon', 'authenticated']) AS public_role(role_name)
      WHERE 0::pg_catalog.oid = ANY (policy.polroles)
    ) AS policy_role
    WHERE namespace.nspname IN ('public', 'storage')
      AND NOT pg_catalog.has_function_privilege(
        policy_role.role_name, dependency.refobjid, 'EXECUTE'
      )
  ) AS offender;

  SELECT pg_catalog.string_agg(offender.description, E'\n  ' ORDER BY offender.description)
  INTO v_view_offenders
  FROM (
    SELECT DISTINCT pg_catalog.format(
      '%s %I.%I (role %s) cannot execute %s',
      CASE relation.relkind WHEN 'm' THEN 'materialized view' ELSE 'view' END,
      namespace.nspname,
      relation.relname,
      view_role.role_name,
      dependency.refobjid::pg_catalog.regprocedure
    ) AS description
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_rewrite AS rewrite_rule
      ON rewrite_rule.ev_class = relation.oid
    JOIN pg_catalog.pg_depend AS dependency
      ON dependency.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass
      AND dependency.objid = rewrite_rule.oid
      AND dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
    CROSS JOIN LATERAL (
      SELECT role_row.rolname::text AS role_name
      FROM pg_catalog.pg_roles AS role_row
      WHERE role_row.rolname !~ '^pg_'
        AND (
          (
            relation.relkind = 'v'
            AND pg_catalog.has_any_column_privilege(role_row.oid, relation.oid, 'SELECT')
          )
          OR (relation.relkind = 'm' AND role_row.oid = relation.relowner)
        )
    ) AS view_role
    WHERE relation.relkind IN ('v', 'm')
      AND namespace.nspname IN ('public', 'storage')
      AND NOT pg_catalog.has_function_privilege(
        view_role.role_name, dependency.refobjid, 'EXECUTE'
      )
  ) AS offender;

  IF v_policy_offenders IS NOT NULL OR v_view_offenders IS NOT NULL THEN
    RAISE EXCEPTION E'functions used by policies or views are not executable by the roles that query them:\n  %\n  %\nGrant EXECUTE on the helper explicitly (GRANT EXECUTE ON FUNCTION ... TO authenticated, anon).',
      COALESCE(v_policy_offenders, '(no policy offenders)'),
      COALESCE(v_view_offenders, '(no view offenders)');
  END IF;
END
$helpers$;
