-- Part of piggyvest_primary_wallet_backing.sql (\ir): no path back to legacy.
-- Runs inside the entry file's transaction; not a standalone suite. The
-- writes below run as the table owner, the most privileged ordinary session:
-- the guard triggers refuse them all the same.

DO $$
BEGIN
  -- backed (1), migrating (7) -> legacy; backed -> migrating.
  PERFORM pg_temp.expect_error(format(
    'UPDATE piggyvest_primary.wallet_backing SET state = %L, audited_amount = NULL, backed_via = NULL,'
    ' move_reference = NULL, migrating_at = NULL, backed_at = NULL WHERE customer_id = %L',
    'legacy', pg_temp.c(1)), '23514', 'wallet_backing_transition_refused');
  PERFORM pg_temp.expect_error(format(
    'UPDATE piggyvest_primary.wallet_backing SET state = %L, audited_amount = NULL, migrating_at = NULL'
    ' WHERE customer_id = %L', 'legacy', pg_temp.c(7)), '23514', 'wallet_backing_transition_refused');
  PERFORM pg_temp.expect_error(format(
    'UPDATE piggyvest_primary.wallet_backing SET state = %L, backed_via = NULL, move_reference = NULL,'
    ' backed_at = NULL WHERE customer_id = %L', 'migrating', pg_temp.c(1)),
    '23514', 'wallet_backing_transition_refused');
  -- A confirmed move cannot skip migrating, by insert or by update.
  PERFORM pg_temp.expect_error(format(
    'INSERT INTO piggyvest_primary.wallet_backing(merchant_id, customer_id, state, onboarding_intent_id,'
    ' audited_amount, backed_via, move_reference, migrating_at, backed_at)'
    ' VALUES (%L, %L, %L, %L, 250, %L, %L, now(), now())',
    pg_temp.m(4), pg_temp.c(4), 'backed', pg_temp.i(4), 'confirmed_move', 'pvb-wt-forged-1'),
    '23514', 'wallet_backing_transition_refused');
  PERFORM pg_temp.expect_error(format(
    'UPDATE piggyvest_primary.wallet_backing SET state = %L, onboarding_intent_id = %L,'
    ' audited_amount = 250, backed_via = %L, move_reference = %L, migrating_at = now(), backed_at = now()'
    ' WHERE customer_id = %L', 'backed', pg_temp.i(8), 'confirmed_move', 'pvb-wt-forged-2', pg_temp.c(8)),
    '23514', 'wallet_backing_transition_refused');
  -- A row must name a customer of its merchant.
  PERFORM pg_temp.expect_error(format(
    'INSERT INTO piggyvest_primary.wallet_backing(merchant_id, customer_id, state) VALUES (%L, %L, %L)',
    pg_temp.id(1), pg_temp.c(6), 'legacy'), '23514', 'wallet_backing_scope_mismatch');
  -- Migration facts and the review flag are permanent.
  PERFORM pg_temp.expect_error(format(
    'UPDATE piggyvest_primary.wallet_backing SET audited_amount = 850 WHERE customer_id = %L',
    pg_temp.c(7)), '23514', 'wallet_backing_facts_immutable');
  PERFORM pg_temp.expect_error(format(
    'UPDATE piggyvest_primary.wallet_backing SET move_reference = %L WHERE customer_id = %L',
    'pvb-wt-other-1', pg_temp.c(1)), '23514', 'wallet_backing_facts_immutable');
  PERFORM pg_temp.expect_error(format(
    'UPDATE piggyvest_primary.wallet_backing SET review_reason = NULL, review_flagged_at = NULL'
    ' WHERE customer_id = %L', pg_temp.c(7)), '23514', 'wallet_backing_facts_immutable');
  PERFORM pg_temp.expect_error(format(
    'UPDATE piggyvest_primary.wallet_backing SET merchant_id = %L WHERE customer_id = %L',
    pg_temp.id(2), pg_temp.c(1)), '23514', 'wallet_backing_facts_immutable');
  -- Rows and events are never removed.
  PERFORM pg_temp.expect_error(format(
    'DELETE FROM piggyvest_primary.wallet_backing WHERE customer_id = %L', pg_temp.c(1)),
    '55000', 'wallet_backing_rows_are_permanent');
  PERFORM pg_temp.expect_error('TRUNCATE piggyvest_primary.wallet_backing CASCADE',
    '55000', 'wallet_backing_rows_are_permanent');
  PERFORM pg_temp.expect_error(
    'UPDATE piggyvest_primary.wallet_backing_events SET amount = 0',
    '55000', 'wallet_backing_events_are_append_only');
  PERFORM pg_temp.expect_error('DELETE FROM piggyvest_primary.wallet_backing_events',
    '55000', 'wallet_backing_events_are_append_only');
  PERFORM pg_temp.expect_error('TRUNCATE piggyvest_primary.wallet_backing_events',
    '55000', 'wallet_backing_events_are_append_only');
  -- One pair per backing row, enforced by the ledger itself too.
  PERFORM pg_temp.expect_error(format(
    'INSERT INTO public.customer_wallet_transactions(wallet_id, customer_id, merchant_id, type, amount,'
    ' balance_after, source_type, source_id) SELECT w.id, w.customer_id, w.merchant_id, %L, 1500, 3000, %L, b.id'
    ' FROM public.customer_wallets w JOIN piggyvest_primary.wallet_backing b ON b.customer_id = w.customer_id'
    ' WHERE w.customer_id = %L', 'adjustment', 'piggyvest_legacy_migration', pg_temp.c(1)),
    '23505', 'duplicate key value violates unique constraint "customer_wallet_transactions_legacy_migration_once"');
  PERFORM pg_temp.check(pg_temp.state(1) = 'backed' AND pg_temp.state(7) = 'migrating'
    AND pg_temp.state(8) = 'legacy', 'refused writes leave every state unchanged');
END $$;

-- The guards are installed and enabled for every write path, and no other
-- function in the schema can set a row back to legacy.
DO $$
BEGIN
  PERFORM pg_temp.check((SELECT count(*) FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'piggyvest_primary.wallet_backing'::regclass AND NOT t.tgisinternal
      AND t.tgenabled = 'O') = 2, 'wallet_backing must carry its row and truncate guards');
  PERFORM pg_temp.check((SELECT count(*) FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'piggyvest_primary.wallet_backing_events'::regclass AND NOT t.tgisinternal
      AND t.tgenabled = 'O') = 2, 'wallet_backing_events must carry its append-only guards');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('piggyvest_primary', 'public')
      AND p.prosrc ~* 'wallet_backing'
      AND p.prosrc ~* 'state\s*=\s*''legacy''\s*(,|where|$)'),
    'no function may write state = legacy into wallet_backing');
END $$;
