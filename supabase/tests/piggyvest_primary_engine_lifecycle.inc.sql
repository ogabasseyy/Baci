-- Part of piggyvest_primary_engine_schema.sql (\ir): transfer row lifecycle,
-- attempts, spend holds and the approval-only interest sweep.
-- Runs inside the entry file's transaction.

-- Every UPDATE bumps row_version; callers cannot set it; identity is frozen.
DO $$
DECLARE
  v_id uuid := pg_temp.wt('collect', 'vtu', 'deliver_before_collect', 'l-version', 'held');
BEGIN
  UPDATE piggyvest_primary.wallet_transfers SET state = 'ready' WHERE id = v_id;
  PERFORM pg_temp.check((SELECT row_version FROM piggyvest_primary.wallet_transfers WHERE id = v_id) = 2,
    'the first update must bump row_version to 2');
  UPDATE piggyvest_primary.wallet_transfers SET effect_state = 'pending' WHERE id = v_id;
  PERFORM pg_temp.check((SELECT row_version FROM piggyvest_primary.wallet_transfers WHERE id = v_id) = 3,
    'every update, even a no-change one, must bump row_version');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfers SET row_version = 99 WHERE id = %L', v_id)) = '42501',
    'callers must not set row_version');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfers SET amount_kobo = 1 WHERE id = %L', v_id)) = '42501',
    'the amount must be immutable');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfers SET destination_wallet_id = ''pv-other'' WHERE id = %L', v_id)) = '42501',
    'the wallets must be immutable');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfers SET outstanding_kobo = amount_kobo + 1 WHERE id = %L', v_id)) <> 'ok',
    'the outstanding amount must never exceed the amount');
  UPDATE piggyvest_primary.wallet_transfers SET outstanding_kobo = 4000 WHERE id = v_id;
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfers SET outstanding_kobo = 5000 WHERE id = %L', v_id)) = '42501',
    'the outstanding amount must never grow');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfers SET state = ''held'' WHERE id = %L', v_id)) = '55000',
    'a transfer must never return to held');
  UPDATE piggyvest_primary.wallet_transfers SET state = 'confirmed' WHERE id = v_id;
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfers SET state = ''ready'' WHERE id = %L', v_id)) = '55000',
    'a confirmed transfer must be final');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'DELETE FROM piggyvest_primary.wallet_transfers WHERE id = %L', v_id)) = '42501',
    'transfers must be append-only');
  -- State-specific rules.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfers SET state = ''failed_unpaid'' WHERE id = %L',
    (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-collect-imei'))) = '23514',
    'only a leg delivered after confirmation (or a payout) can end unpaid');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfers SET state = ''awaiting_float'' WHERE id = %L',
    (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-goal-refund'))) = '23514',
    'only legs paid from Collection can wait for float');
END $$;

-- Attempts: one reference per attempt, never reused, one open attempt at a time.
DO $$
DECLARE
  v_id uuid := pg_temp.wt('collect', 'vtu', 'deliver_before_collect', 'l-attempts', 'ready', 2500);
  v_attempt uuid;
BEGIN
  INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
    VALUES (v_id, 1, 'pvb-wt-' || v_id || '-1', 2500) RETURNING id INTO v_attempt;
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
     VALUES (%L, 2, %L, 2500)', v_id, 'pvb-wt-' || v_id || '-2')) = '23505',
    'a second attempt must wait until the first is proven failed or aborted');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
     VALUES (%L, 3, %L, 2500)', v_id, 'pvb-wt-' || v_id || '-3')) <> 'ok',
    'attempt numbers must be consecutive');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
     VALUES (%L, 2, %L, 2500)', v_id, 'pvb-wt-custom')) = '23514',
    'a reference must be pvb-wt-<transfer>-<attempt>');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET fee_kobo = -1 WHERE id = %L', v_attempt)) = '23514',
    'a fee must not be negative');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET state = ''failed'' WHERE id = %L', v_attempt)) = '23514',
    'only a recorded proof can mark an attempt failed');
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'failed', proof = '{"status":"failed"}',
    resolved_at = TIMESTAMPTZ '2026-10-31 01:00:00+00' WHERE id = v_attempt;
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET state = ''confirmed'' WHERE id = %L', v_attempt)) = '55000',
    'a failed attempt must be final');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
     VALUES (%L, 2, %L, 2501)', v_id, 'pvb-wt-' || v_id || '-2')) = '23514',
    'an attempt must not ask for more than is outstanding');
  INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
    VALUES (v_id, 2, 'pvb-wt-' || v_id || '-2', 2500) RETURNING id INTO v_attempt;
  UPDATE piggyvest_primary.wallet_transfer_attempts SET provider_transaction_id = 'pv-txn-engine-1', fee_kobo = 0
    WHERE id = v_attempt;
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET provider_transaction_id = ''pv-txn-engine-2'' WHERE id = %L',
    v_attempt)) = '42501', 'a recorded provider transaction id must be immutable');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET reference = ''pvb-wt-reused'' WHERE id = %L', v_attempt)) = '42501',
    'a reference must be immutable');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'DELETE FROM piggyvest_primary.wallet_transfer_attempts WHERE id = %L', v_attempt)) = '42501',
    'a reference must stay unique forever: attempts are never deleted');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
     VALUES (%L, 1, %L, 100)', (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-legacy'),
     'pvb-wt-' || (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-legacy') || '-1')) = 'ok',
    'another transfer starts its own attempts');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET provider_transaction_id = ''pv-txn-engine-1''
     WHERE reference = %L', 'pvb-wt-' || (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-legacy') || '-1')) = '23505',
    'a provider transaction id must belong to one attempt');
END $$;

-- Spend holds: one active hold per reason and leg; released once.
DO $$
DECLARE
  v_hold uuid;
BEGIN
  INSERT INTO piggyvest_primary.wallet_spend_holds(integration_id, customer_id, reason, detail)
    VALUES (pg_temp.id(5), pg_temp.id(3), 'negative_drift', 'engine suite') RETURNING id INTO v_hold;
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.wallet_spend_holds(integration_id, customer_id, reason) VALUES (%L, %L, ''negative_drift'')',
    pg_temp.id(5), pg_temp.id(3))) = '23505', 'one active hold per reason');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.wallet_spend_holds(integration_id, customer_id, reason) VALUES (%L, %L, ''collect_review'')',
    pg_temp.id(5), pg_temp.id(3))) = '23514', 'a collect review hold must name its leg');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.wallet_spend_holds(integration_id, customer_id, reason) VALUES (%L, %L, ''cashback'')',
    pg_temp.id(5), pg_temp.id(3))) = '23514', 'an unknown hold reason must be refused');
  UPDATE piggyvest_primary.wallet_spend_holds SET released_at = TIMESTAMPTZ '2026-10-31 02:00:00+00' WHERE id = v_hold;
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_spend_holds SET released_at = NULL WHERE id = %L', v_hold)) = '42501',
    'a released hold must stay released');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'DELETE FROM piggyvest_primary.wallet_spend_holds WHERE id = %L', v_hold)) = '42501', 'holds are never deleted');
END $$;

-- interest_sweep is approval-only: no row except from enqueue_misrouted_interest_sweep.
DO $$
BEGIN
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'SELECT pg_temp.wt(''interest_sweep'', ''misrouted_interest'', ''credit_house'', ''l-sweep-direct'')') = '42501',
    'an interest sweep must not be inserted directly');
  -- Only while the declared stub is still in place (its owner replaces it).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE position('engine-stub' IN prosrc) > 0
    AND oid = 'piggyvest_primary.enqueue_misrouted_interest_sweep(uuid, uuid, text, bigint, uuid)'::regprocedure) THEN
    PERFORM pg_temp.check(pg_temp.error_of(format(
      'SELECT piggyvest_primary.enqueue_misrouted_interest_sweep(%L, %L, ''pv-interest-txn'', 100, %L)',
      pg_temp.id(5), pg_temp.id(3), pg_temp.id(950))) LIKE '%not installed%',
      'the pre-declared enqueue stub must refuse');
  END IF;
END $$;

CREATE FUNCTION pg_temp.other_sweep_writer() RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.wt('interest_sweep', 'misrouted_interest', 'credit_house', 'l-sweep-other');
END $$;

-- A future owner implementation (simulated here, rolled back with the suite)
-- is the only writer the guard admits.
CREATE OR REPLACE FUNCTION piggyvest_primary.enqueue_misrouted_interest_sweep(
  p_integration_id uuid, p_customer_id uuid, p_payout_transaction_id text, p_amount_kobo bigint, p_approval_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  RETURN pg_temp.wt('interest_sweep', 'misrouted_interest', 'credit_house', p_payout_transaction_id, 'ready', p_amount_kobo);
END $$;

DO $$
BEGIN
  PERFORM pg_temp.check(piggyvest_primary.enqueue_misrouted_interest_sweep(
    pg_temp.id(5), pg_temp.id(3), 'l-sweep-owner', 700, pg_temp.id(950)) IS NOT NULL,
    'the owner implementation must be able to enqueue the sweep');
  PERFORM pg_temp.check((SELECT source_wallet_id || '>' || destination_wallet_id FROM piggyvest_primary.wallet_transfers
    WHERE source_ref = 'l-sweep-owner') = 'pv-engine-main>pv-house-interest', 'a sweep moves main to interest');
  PERFORM pg_temp.check(pg_temp.sqlstate_of('SELECT pg_temp.other_sweep_writer()') = '42501',
    'any other function must still be refused');
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.enqueue_misrouted_interest_sweep(
  p_integration_id uuid, p_customer_id uuid, p_payout_transaction_id text, p_amount_kobo bigint, p_approval_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  -- engine-stub
  RAISE EXCEPTION 'misrouted interest sweep is not installed' USING ERRCODE = '0A000';
END $$;
