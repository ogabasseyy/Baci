BEGIN;
-- Follow-up to 093400: its two piggyvest_primary trigger functions
-- kept the default PUBLIC EXECUTE grant. bank_role_safe fails any
-- bank inbox/worker session that can execute a piggyvest_primary
-- function outside its allowlist, so every function in that schema
-- must revoke PUBLIC (revoked trigger functions still fire). Without
-- this, intake and worker reject all deposits once 093400 lands. Only
-- the PUBLIC grant ever existed (no explicit role grants), so
-- revoking PUBLIC plus the standard roles suffices; the bank roles
-- are deliberately not named so this migration stays includable in
-- chains without the bank surface.
REVOKE ALL ON FUNCTION piggyvest_primary.block_unsettled_savings_customer_deletion()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION piggyvest_primary.block_unsettled_savings_goal_deletion()
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
