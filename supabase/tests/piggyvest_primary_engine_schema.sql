-- Contract test: the PiggyVest transfer-engine schema (P5-engine-schema).
--
-- Proves, against live PostgreSQL:
--   * the engine tables are unreachable for every API role (RLS deny-all, no
--     grants, no schema usage) and the engine functions are SECURITY DEFINER
--     with a pinned search_path and exactly the intended grants;
--   * house wallets: one per purpose, never a customer wallet, immutable once
--     verified; the read helper returns them with their readiness;
--   * the transfer-kind matrix: every declared (kind, source, destination)
--     is accepted with its own wallets and every other one is rejected;
--     purposes, delivery modes, duplicates, holds, exit claims and refunds;
--   * row lifecycle: row_version is bumped on every update and cannot be set
--     by callers, identity is frozen, settled states are final, attempts use
--     pvb-wt-<transfer>-<attempt> references that are never reused;
--   * interest sweeps exist only through enqueue_misrouted_interest_sweep,
--     whose shipped stub refuses;
--   * the B writer: duplicates, the R4 family cap (review, no write), hold
--     debits only inline in an engine session, payout freezes only by the
--     worker, API sessions only request, the worker applies each request once;
--   * hooks exist, return 'noop' while they are stubs, and the dispatchers
--     route to their per-purpose sub-hooks;
--   * account deletion detaches settled engine rows (evidence kept) and is
--     refused while a transfer, a B request or a spend hold is open.
-- The two-backend apply race is in piggyvest_primary_engine_b_effects_concurrency.sql.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_engine_schema.sql

BEGIN;

-- The ordered parts share this transaction and session (psql \ir, relative to
-- this file); they are not wired into CI on their own.

\ir piggyvest_primary_engine_fixture.inc.sql

\ir piggyvest_primary_engine_catalog.inc.sql

\ir piggyvest_primary_engine_house_wallets.inc.sql

\ir piggyvest_primary_engine_matrix.inc.sql

\ir piggyvest_primary_engine_lifecycle.inc.sql

\ir piggyvest_primary_engine_hooks.inc.sql

\ir piggyvest_primary_engine_b_effects.inc.sql

\ir piggyvest_primary_engine_detach.inc.sql

ROLLBACK;
