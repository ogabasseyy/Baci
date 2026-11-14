-- REGRESSION TEST: wallet transaction PIN store and single-use, debit-bound
-- PIN proofs (migrations 20261102202600..20261102202603).
--
-- USAGE (CI DB Replay runs it through the replay registry):
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/wallet_pin_store.sql
--
-- This entry point owns the transaction and loads its parts with \ir so each
-- file stays under 300 lines. The parts run in order against one fixture;
-- each part uses its own customer, so they do not depend on one another's
-- PIN state.
--   _fixture.inc.sql     users, sessions, merchants, customers, helpers
--   _calls.inc.sql       server attestation helpers and RPC call builders
--   _catalog.inc.sql     private schema closed; grants exactly as intended
--   _set_verify.inc.sql  set, state, verify, input checks, tenant isolation
--   _attestation.inc.sql unattested set/change/reset/verify refused
--   _lockout.inc.sql     5 failures lock 30 min, escalating, 24h cap
--   _reset.inc.sql       re-authenticated reset, change
--   _proofs.inc.sql      single use, expiry, binding, cap, kill switch
--   _binding.inc.sql     PIN bound to its account; soft-deleted customer
--
-- Row-lock behaviour under two live backends is covered separately by
-- wallet_pin_store_concurrency.sql (it needs committed fixtures).
--
-- Privileges are asserted through the catalog, never by calling a function
-- the role cannot execute (a denied EXECUTE cannot be trapped on the replay
-- image).

BEGIN;

SET LOCAL search_path = pg_catalog, public, extensions;

\ir wallet_pin_store_fixture.inc.sql
\ir wallet_pin_store_calls.inc.sql
\ir wallet_pin_store_catalog.inc.sql
\ir wallet_pin_store_set_verify.inc.sql
\ir wallet_pin_store_attestation.inc.sql
\ir wallet_pin_store_lockout.inc.sql
\ir wallet_pin_store_reset.inc.sql
\ir wallet_pin_store_proofs.inc.sql
\ir wallet_pin_store_binding.inc.sql

ROLLBACK;
