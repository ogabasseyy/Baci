-- Contract test: PiggyVest wallet backing state (Ledger decision: one kind of
-- money per wallet, legacy -> migrating -> backed, never back).
--
-- Proves, against live PostgreSQL:
--   * every existing wallet is legacy and wallet_backing ships empty;
--   * begin_migration refuses unverified, cross-merchant, mismatched and
--     pending wallets, and an audited zero (or no wallet row) goes straight
--     to backed with no wallet or ledger write, idempotently;
--   * flip_to_backed only moves a migrating wallet, sets backed before it
--     writes the single relabel pair, keeps available_balance at the audited
--     amount, writes one pair however often it runs, and refuses or reviews
--     anything else;
--   * no write path leads back to legacy (guard triggers, no table grants);
--   * the hooks are no-ops, onboarding_verified_hook_ready() is false, and a
--     raising hook never undoes a flip;
--   * get_my_wallet_backing_state returns only the caller's own state;
--   * privileges are asserted through the catalog: a denied EXECUTE cannot be
--     trapped on the replay image, so no denial is probed by calling.
-- Transitions run as the session role (the function owner); dedicated
-- logins do not exist yet, so their grants are checked in the catalog part.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_wallet_backing.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

-- Runs p_sql and requires exactly this SQLSTATE and message.
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_state text, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'expected % (%) from: %', p_message, p_state, p_sql
    USING ERRCODE = 'ZEXP1';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = 'ZEXP1' THEN RAISE; END IF;
  IF SQLSTATE IS DISTINCT FROM p_state OR SQLERRM IS DISTINCT FROM p_message THEN
    RAISE EXCEPTION 'expected % (%), got % (%) from: %',
      p_message, p_state, SQLERRM, SQLSTATE, p_sql;
  END IF;
END $$;

CREATE FUNCTION pg_temp.id(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('b5c00000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

-- Fixture customer k belongs to merchant 1 except k = 6 (merchant 2).
CREATE FUNCTION pg_temp.m(p_k int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_temp.id(CASE WHEN p_k = 6 THEN 2 ELSE 1 END)
$$;

CREATE FUNCTION pg_temp.c(p_k int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_temp.id(200 + p_k)
$$;

CREATE FUNCTION pg_temp.i(p_k int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_temp.id(300 + p_k)
$$;

CREATE FUNCTION pg_temp.state(p_k int) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN piggyvest_primary.backing_state(pg_temp.c(p_k), pg_temp.m(p_k));
END $$;

CREATE FUNCTION pg_temp.begin_move(p_k int, p_amount numeric) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  RETURN piggyvest_primary.begin_migration(
    pg_temp.c(p_k), pg_temp.m(p_k), pg_temp.i(p_k), p_amount);
END $$;

CREATE FUNCTION pg_temp.flip(p_k int) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN piggyvest_primary.flip_to_backed(
    pg_temp.c(p_k), pg_temp.m(p_k), 'pvb-wt-' || pg_temp.c(p_k)::text || '-1');
END $$;

CREATE FUNCTION pg_temp.ledger_rows(p_k int) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.customer_wallet_transactions
  WHERE customer_id = pg_temp.c(p_k)
$$;

CREATE FUNCTION pg_temp.relabel_rows(p_k int) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.customer_wallet_transactions
  WHERE customer_id = pg_temp.c(p_k) AND source_type = 'piggyvest_legacy_migration'
$$;

CREATE FUNCTION pg_temp.events(p_k int) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT count(*) FROM piggyvest_primary.wallet_backing_events e
    JOIN piggyvest_primary.wallet_backing b ON b.id = e.backing_id
    WHERE b.customer_id = pg_temp.c(p_k));
END $$;

-- Every money column plus updated_at: an unchanged snapshot means no write.
CREATE FUNCTION pg_temp.wallet(p_k int) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE((SELECT row(w.id, w.available_balance, w.total_earned,
    w.total_redeemed, w.updated_at)::text
    FROM public.customer_wallets w WHERE w.customer_id = pg_temp.c(p_k)), 'none')
$$;

-- The ordered parts share this transaction and session (psql \ir, relative to
-- this file); they are not wired into CI on their own.

\ir piggyvest_primary_wallet_backing_fixtures.inc.sql

\ir piggyvest_primary_wallet_backing_begin.inc.sql

\ir piggyvest_primary_wallet_backing_flip.inc.sql

\ir piggyvest_primary_wallet_backing_guards.inc.sql

\ir piggyvest_primary_wallet_backing_hooks.inc.sql

\ir piggyvest_primary_wallet_backing_rpc.inc.sql

\ir piggyvest_primary_wallet_backing_catalog.inc.sql

ROLLBACK;
