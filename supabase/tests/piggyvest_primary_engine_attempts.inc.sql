-- Part of piggyvest_primary_engine_schema.sql (\ir): transfer attempts.
-- Runs inside the entry file's transaction.

-- Tries every change to the evidence, lease and timing columns of an attempt
-- and returns those the database accepted. The state is not among them:
-- state moves have their own checks.
CREATE FUNCTION pg_temp.attempt_changes_accepted(p_attempt uuid) RETURNS text[]
LANGUAGE plpgsql AS $$
DECLARE
  v_change text;
  v_accepted text[] := '{}';
BEGIN
  FOREACH v_change IN ARRAY ARRAY[
    'provider_transaction_id = ''pv-txn-late''', 'fee_kobo = 7', 'proof = ''{"status":"late"}''',
    'lease_token = pg_catalog.gen_random_uuid(), lease_until = pg_catalog.clock_timestamp()',
    'dispatched_at = pg_catalog.clock_timestamp()', 'resolved_at = pg_catalog.clock_timestamp()'] LOOP
    IF pg_temp.sqlstate_of(format(
      'UPDATE piggyvest_primary.wallet_transfer_attempts SET %s WHERE id = %L', v_change, p_attempt)) = 'ok' THEN
      v_accepted := v_accepted || v_change;
    END IF;
  END LOOP;
  RETURN v_accepted;
END $$;

-- Attempts: one reference per attempt, never reused, one open attempt at a
-- time, states only forward, and only a never-sent attempt can be aborted.
DO $$
DECLARE
  v_id uuid := pg_temp.wt('collect', 'vtu', 'deliver_before_collect', 'l-attempts', 'ready', 2500);
  v_attempt uuid;
  v_state text;
  v_sql text := 'INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
     VALUES (%L, %s, %L, %s)';
BEGIN
  INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
    VALUES (v_id, 1, 'pvb-wt-' || v_id || '-1', 2500) RETURNING id INTO v_attempt;
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(v_sql, v_id, 2, 'pvb-wt-' || v_id || '-2', 2500)) = '23505',
    'a second attempt must wait until the first is proven failed or aborted');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(v_sql, v_id, 2, 'pvb-wt-custom', 2500)) = '23514',
    'a reference must be pvb-wt-<transfer>-<attempt>');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET fee_kobo = -1 WHERE id = %L', v_attempt)) = '23514',
    'a fee must not be negative');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET state = ''submitted'' WHERE id = %L', v_attempt)) = '55000',
    'a prepared attempt must be dispatched before it is submitted');
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'dispatching' WHERE id = v_attempt;
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET state = ''prepared'' WHERE id = %L', v_attempt)) = '55000',
    'an attempt must never move back to prepared');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET state = ''aborted'' WHERE id = %L', v_attempt)) = '55000',
    'an attempt that may have been sent must never be aborted');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET state = ''failed'' WHERE id = %L', v_attempt)) = '23514',
    'only a recorded proof can mark an attempt failed');
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'unknown' WHERE id = v_attempt;
  FOREACH v_state IN ARRAY ARRAY['aborted', 'dispatching', 'prepared'] LOOP
    PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
      'UPDATE piggyvest_primary.wallet_transfer_attempts SET state = %L WHERE id = %L', v_state, v_attempt)) = '55000',
      format('an unknown attempt must never become %s', v_state));
  END LOOP;
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'submitted' WHERE id = v_attempt;
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'failed', proof = '{"status":"failed"}',
    resolved_at = TIMESTAMPTZ '2026-10-31 01:00:00+00' WHERE id = v_attempt;
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET state = ''confirmed'' WHERE id = %L', v_attempt)) = '55000',
    'a failed attempt must be final');
  -- A failed attempt keeps what it recorded: it can still gain no provider
  -- transaction id, fee, lease or timing, and no recorded value changes.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET provider_transaction_id = ''pv-txn-late'' WHERE id = %L',
    v_attempt)) = '55000', 'a failed attempt must not gain a provider transaction id');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET resolved_at = pg_catalog.clock_timestamp() WHERE id = %L',
    v_attempt)) = '42501', 'the time an attempt resolved must never change');
  PERFORM pg_temp.check(pg_temp.attempt_changes_accepted(v_attempt) = '{}', format(
    'a failed attempt must accept no change, got %s', pg_temp.attempt_changes_accepted(v_attempt)));
  -- No attempt is open now, so only the numbering rule can refuse this one.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(v_sql, v_id, 3, 'pvb-wt-' || v_id || '-3', 2500)) = '23514',
    'attempt numbers must be consecutive');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(v_sql, v_id, 2, 'pvb-wt-' || v_id || '-2', 2501)) = '23514',
    'an attempt must not ask for more than is outstanding');
  -- A prepared attempt was never sent, so it may be aborted.
  INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
    VALUES (v_id, 2, 'pvb-wt-' || v_id || '-2', 2500) RETURNING id INTO v_attempt;
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'aborted' WHERE id = v_attempt;
  PERFORM pg_temp.check(pg_temp.attempt_changes_accepted(v_attempt) = '{}', format(
    'an aborted attempt must accept no change, got %s', pg_temp.attempt_changes_accepted(v_attempt)));
  INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
    VALUES (v_id, 3, 'pvb-wt-' || v_id || '-3', 2500) RETURNING id INTO v_attempt;
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'dispatching',
    dispatched_at = TIMESTAMPTZ '2026-10-31 02:00:00+00' WHERE id = v_attempt;
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'submitted', provider_transaction_id = 'pv-txn-engine-1',
    fee_kobo = 0 WHERE id = v_attempt;
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET provider_transaction_id = ''pv-txn-engine-2'' WHERE id = %L',
    v_attempt)) = '42501', 'a recorded provider transaction id must be immutable');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET dispatched_at = pg_catalog.clock_timestamp() WHERE id = %L',
    v_attempt)) = '42501', 'the time an attempt was first sent must be immutable');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfer_attempts SET reference = ''pvb-wt-reused'' WHERE id = %L', v_attempt)) = '42501',
    'a reference must be immutable');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'DELETE FROM piggyvest_primary.wallet_transfer_attempts WHERE id = %L', v_attempt)) = '42501',
    'a reference must stay unique forever: attempts are never deleted');
  -- A confirmed attempt ends the transfer's attempts before settle runs.
  UPDATE piggyvest_primary.wallet_transfers SET state = 'submitted' WHERE id = v_id;
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'confirmed', proof = '{"status":"successful"}'
    WHERE id = v_attempt;
  PERFORM pg_temp.check(pg_temp.attempt_changes_accepted(v_attempt) = '{}', format(
    'a confirmed attempt must accept no change, got %s', pg_temp.attempt_changes_accepted(v_attempt)));
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(v_sql, v_id, 4, 'pvb-wt-' || v_id || '-4', 2500)) = '55000',
    'a transfer with a confirmed attempt must take no new attempt');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.wallet_transfers SET state = ''cancelled'' WHERE id = %L', v_id)) = '55000',
    'a transfer with a confirmed attempt must never be cancelled');
  -- A settled transfer takes no attempt at all.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(v_sql, (SELECT id FROM piggyvest_primary.wallet_transfers
    WHERE source_ref = 'l-version'), 2, 'pvb-wt-' || (SELECT id FROM piggyvest_primary.wallet_transfers
    WHERE source_ref = 'l-version') || '-2', 1)) = '55000', 'a confirmed transfer must take no attempt');
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
