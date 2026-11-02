-- Contract test: two-person approvals for PiggyVest operations (default 8).
--
-- Proves, against live PostgreSQL:
--   * catalog: the approver role executes only approve_ops_request and
--     list_open_ops_requests; open_ops_request and consume_two_approvals are
--     granted to nobody; anon, authenticated and service_role reach nothing;
--     an extra role membership disqualifies an approver login;
--   * runtime, through real logins (one dblink connection per login, so
--     SESSION_USER really differs): the same login twice, the requester as
--     approver and a single approval are refused; two distinct approvals
--     consume exactly once; a changed row version, amount or destination
--     invalidates; an expired request is refused and can be asked again;
--     any reject closes, and the same values cannot be asked again; a jsonb
--     'approver' key is ignored; a later engine-role grant voids an approval;
--     only a dedicated login can open a request; a caller's temporary
--     objects never run inside the functions; expiry is judged once the
--     locks are held, even when a call waited for them.
--
-- The runtime part needs committed rows and logins, so it runs outside a
-- transaction and removes everything it created at the end (and at the
-- start, after an aborted earlier run). Test logins get a password made from
-- a random secret that lives only in this session, valid for 30 minutes.
--
-- Auth: dblink connects to this server as each test login with that
-- password. dblink is dropped at the end only if this file created it.
--
-- Usage: only against a disposable database (the CI DB Replay or a local
-- scratch cluster), never a shared or hosted one:
--   psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_ops_approvals.sql

\set ON_ERROR_STOP on

BEGIN;
\ir piggyvest_primary_ops_approvals_catalog.inc.sql
ROLLBACK;

SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'dblink'
) AS pvops_had_dblink \gset

CREATE EXTENSION IF NOT EXISTS dblink;

\ir piggyvest_primary_ops_approvals_cleanup.inc.sql
\ir piggyvest_primary_ops_approvals_fixture.inc.sql
\ir piggyvest_primary_ops_approvals_consume.inc.sql
\ir piggyvest_primary_ops_approvals_binding.inc.sql
\ir piggyvest_primary_ops_approvals_hardening.inc.sql
\ir piggyvest_primary_ops_approvals_expiry_race.inc.sql
\ir piggyvest_primary_ops_approvals_cleanup.inc.sql

\if :pvops_had_dblink
\else
DROP EXTENSION IF EXISTS dblink;
\endif
