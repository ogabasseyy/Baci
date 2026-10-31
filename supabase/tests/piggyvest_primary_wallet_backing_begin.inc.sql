-- Part of piggyvest_primary_wallet_backing.sql (\ir): begin_migration.
-- Runs inside the entry file's transaction; not a standalone suite.

-- Refusals write nothing: no backing row, no event, no wallet or ledger write.
DO $$
DECLARE
  v_wallet text := pg_temp.wallet(4);
  v_rows bigint := pg_temp.ledger_rows(4);
BEGIN
  PERFORM pg_temp.expect_error('SELECT pg_temp.begin_move(4, 500.00)',
    '55000', 'wallet_backing_unverified');
  PERFORM pg_temp.expect_error('SELECT pg_temp.begin_move(10, 100.00)',
    '55000', 'wallet_backing_unverified');
  PERFORM pg_temp.check(pg_temp.wallet(4) = v_wallet AND pg_temp.ledger_rows(4) = v_rows,
    'an unverified refusal must not write the wallet or ledger');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing
    WHERE customer_id IN (pg_temp.c(4), pg_temp.c(10))), 'an unverified refusal must not record a row');
END $$;

-- Cross-merchant: the customer, the intent and the merchant must all agree.
DO $$
BEGIN
  PERFORM pg_temp.expect_error(format(
    'SELECT piggyvest_primary.begin_migration(%L, %L, %L, 300.00)',
    pg_temp.c(6), pg_temp.id(1), pg_temp.i(6)), '42501', 'wallet_backing_scope_unavailable');
  PERFORM pg_temp.expect_error(format(
    'SELECT piggyvest_primary.begin_migration(%L, %L, %L, 1500.00)',
    pg_temp.c(1), pg_temp.id(1), pg_temp.i(6)), '42501', 'wallet_backing_scope_unavailable');
  PERFORM pg_temp.expect_error(format(
    'SELECT piggyvest_primary.begin_migration(%L, %L, %L, 1500.00)',
    pg_temp.c(1), pg_temp.id(2), pg_temp.i(1)), '42501', 'wallet_backing_scope_unavailable');
  PERFORM pg_temp.expect_error(format(
    'SELECT piggyvest_primary.begin_migration(%L, %L, %L, 1500.00)',
    pg_temp.c(1), pg_temp.id(1), pg_temp.i(2)), '42501', 'wallet_backing_scope_unavailable');
  PERFORM pg_temp.expect_error(format(
    'SELECT piggyvest_primary.begin_migration(%L, %L, NULL, 1500.00)',
    pg_temp.c(1), pg_temp.id(1)), '22023', 'wallet_backing_scope_required');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing
    WHERE customer_id IN (pg_temp.c(1), pg_temp.c(6))), 'a scope refusal must not record a row');
END $$;

-- Mismatched or malformed audited amounts, and a pending legacy ledger row.
DO $$
DECLARE
  v_wallet text := pg_temp.wallet(5);
BEGIN
  PERFORM pg_temp.expect_error('SELECT pg_temp.begin_move(7, 800.00)',
    '22023', 'wallet_backing_amount_mismatch');
  PERFORM pg_temp.expect_error('SELECT pg_temp.begin_move(3, 10.00)',
    '22023', 'wallet_backing_amount_mismatch');
  PERFORM pg_temp.expect_error('SELECT pg_temp.begin_move(1, 1500.001)',
    '22023', 'wallet_backing_invalid_amount');
  PERFORM pg_temp.expect_error('SELECT pg_temp.begin_move(1, -1)',
    '22023', 'wallet_backing_invalid_amount');
  PERFORM pg_temp.expect_error('SELECT pg_temp.begin_move(1, NULL)',
    '22023', 'wallet_backing_invalid_amount');
  PERFORM pg_temp.expect_error('SELECT pg_temp.begin_move(5, 700.00)',
    '55000', 'wallet_backing_pending_ledger');
  PERFORM pg_temp.check(pg_temp.wallet(5) = v_wallet, 'a pending refusal must not write the wallet');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing
    WHERE customer_id IN (pg_temp.c(3), pg_temp.c(5), pg_temp.c(7))), 'a refusal must not record a row');
END $$;

-- Audited zero, and no wallet row at all: straight to backed with no wallet or
-- ledger write; a repeat is a no-op.
DO $$
DECLARE
  v_wallet text := pg_temp.wallet(2);
  v_rows bigint := pg_temp.ledger_rows(2);
  v_result jsonb;
  v_backing piggyvest_primary.wallet_backing%ROWTYPE;
BEGIN
  v_result := pg_temp.begin_move(2, 0);
  PERFORM pg_temp.check(v_result->>'status' = 'backed' AND (v_result->>'changed')::boolean,
    'an audited zero must go straight to backed: ' || v_result::text);
  SELECT * INTO v_backing FROM piggyvest_primary.wallet_backing WHERE customer_id = pg_temp.c(2);
  PERFORM pg_temp.check(v_backing.backed_via = 'audited_zero' AND v_backing.audited_amount = 0
    AND v_backing.onboarding_intent_id = pg_temp.i(2) AND v_backing.migrating_at IS NULL,
    'an audited zero records its intent and no migration');
  PERFORM pg_temp.check((v_result->>'backingId')::uuid = v_backing.id, 'begin must return the backing id');
  v_result := pg_temp.begin_move(2, 0);
  PERFORM pg_temp.check(v_result->>'status' = 'backed' AND NOT (v_result->>'changed')::boolean,
    'a repeated audited zero must be a no-op');
  PERFORM pg_temp.check(pg_temp.wallet(2) = v_wallet AND pg_temp.ledger_rows(2) = v_rows,
    'an audited zero must not write the wallet or ledger');
  PERFORM pg_temp.check(pg_temp.events(2) = 1, 'an audited zero records exactly one event');

  v_result := pg_temp.begin_move(3, 0);
  PERFORM pg_temp.check(v_result->>'status' = 'backed' AND (v_result->>'changed')::boolean,
    'no wallet row is an audited zero: ' || v_result::text);
  PERFORM pg_temp.check(pg_temp.begin_move(3, 0)->>'changed' = 'false', 'a repeat must be a no-op');
  PERFORM pg_temp.check(pg_temp.wallet(3) = 'none' AND pg_temp.ledger_rows(3) = 0,
    'an audited zero must not create a wallet or ledger row');
  PERFORM pg_temp.check(pg_temp.state(2) = 'backed' AND pg_temp.state(3) = 'backed',
    'audited zero wallets are backed');
  PERFORM pg_temp.check(piggyvest_primary.is_backed(pg_temp.c(3), pg_temp.m(3)),
    'is_backed must report an audited zero wallet');
END $$;

-- A clean non-zero balance locks as migrating, unchanged; repeats are no-ops
-- and a different amount is still refused.
DO $$
DECLARE
  v_wallet text := pg_temp.wallet(1);
  v_rows bigint := pg_temp.ledger_rows(1);
  v_result jsonb;
BEGIN
  v_result := pg_temp.begin_move(1, 1500.00);
  PERFORM pg_temp.check(v_result->>'status' = 'migrating' AND (v_result->>'changed')::boolean,
    'a clean balance must lock as migrating: ' || v_result::text);
  PERFORM pg_temp.check(pg_temp.begin_move(1, 1500)->>'changed' = 'false', 'a repeat must be a no-op');
  PERFORM pg_temp.expect_error('SELECT pg_temp.begin_move(1, 1400.00)',
    '22023', 'wallet_backing_amount_mismatch');
  PERFORM pg_temp.check(pg_temp.wallet(1) = v_wallet AND pg_temp.ledger_rows(1) = v_rows,
    'begin_migration must not write the wallet or ledger');
  PERFORM pg_temp.check(pg_temp.events(1) = 1, 'begin records exactly one event');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing_events e
    JOIN piggyvest_primary.wallet_backing b ON b.id = e.backing_id
    WHERE b.customer_id = pg_temp.c(1) AND e.event = 'migration_begun'
      AND e.from_state = 'legacy' AND e.to_state = 'migrating' AND e.amount = 1500.00
      AND e.session_login = session_user), 'the begin event records the audited amount');
  PERFORM pg_temp.check(pg_temp.state(1) = 'migrating', 'customer 1 is migrating');
  PERFORM pg_temp.check(NOT piggyvest_primary.is_backed(pg_temp.c(1), pg_temp.m(1)),
    'a migrating wallet is not backed');
  PERFORM pg_temp.expect_error(format('SELECT piggyvest_primary.assert_wallet_legacy(%L, %L)',
    pg_temp.c(1), pg_temp.m(1)), 'P0001', 'piggyvest_wallet_fenced');
  PERFORM pg_temp.expect_error(format('SELECT piggyvest_primary.assert_wallet_legacy(%L, %L)',
    pg_temp.c(2), pg_temp.m(2)), 'P0001', 'piggyvest_wallet_fenced');
  PERFORM pg_temp.expect_error(format('SELECT piggyvest_primary.backing_state(%L, %L)',
    pg_temp.c(1), pg_temp.id(2)), '42501', 'wallet_backing_scope_unavailable');

  PERFORM pg_temp.check(pg_temp.begin_move(7, 900.00)->>'status' = 'migrating', 'customer 7 locks');
  PERFORM pg_temp.check(pg_temp.begin_move(9, 400.00)->>'status' = 'migrating', 'customer 9 locks');
  PERFORM pg_temp.check(pg_temp.begin_move(12, 600.00)->>'status' = 'migrating', 'customer 12 locks');
END $$;
