-- REGRESSION TEST: effective EXECUTE exposure of public SECURITY DEFINER
-- functions (the PostgREST /rest/v1/rpc surface) and the default privileges
-- that cause it.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/public_definer_function_exposure.sql
--
-- Why: functions created by the migration owner (postgres) in schema public are
-- granted EXECUTE to anon, authenticated and service_role by default
-- privileges, and to PUBLIC by PostgreSQL's built-in default. A DROP + CREATE
-- followed by REVOKE ... FROM PUBLIC leaves the direct anon/authenticated
-- grants in place. Migration 20261030233000 closes the defaults and revokes
-- functions with no anon caller; this suite keeps them closed. The grant rules
-- are in docs/agent-guidance/function-privileges.md.
--
-- This entry point owns the transaction and loads the checks with \ir so one
-- --sql-check runs them all (each file stays under 300 lines):
--   _defaults.inc.sql       (a) a new function is closed by default
--   _allowlist.inc.sql      allowlist rows (exact signature + reason)
--   _allowlist_check.inc.sql (b) anon/PUBLIC definer functions are allowlisted
--   _revoked.inc.sql        (c) the revoked functions stay revoked
--   _policy_helpers.inc.sql (d) policy and view helpers are executable

BEGIN;

SET LOCAL search_path = pg_catalog, public, extensions;

\ir public_definer_function_exposure_defaults.inc.sql
\ir public_definer_function_exposure_allowlist.inc.sql
\ir public_definer_function_exposure_allowlist_check.inc.sql
\ir public_definer_function_exposure_revoked.inc.sql
\ir public_definer_function_exposure_policy_helpers.inc.sql

ROLLBACK;
