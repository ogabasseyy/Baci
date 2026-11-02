-- Part of piggyvest_primary_wallet_backing.sql (\ir): flip_to_backed.
-- Runs inside the entry file's transaction; not a standalone suite.

-- Records the backing state each relabel row sees when it is written, so the
-- suite can prove the state was already backed (the observer is dropped with
-- the transaction).
CREATE TEMP TABLE relabel_seen(leg text, state text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.observe_relabel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_type = 'piggyvest_legacy_migration' THEN
    INSERT INTO relabel_seen VALUES (NEW.metadata->>'leg',
      piggyvest_primary.backing_state(NEW.customer_id, NEW.merchant_id));
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER wallet_backing_suite_observe_relabel
  BEFORE INSERT ON public.customer_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION pg_temp.observe_relabel();

-- A wallet that never began migrating is refused and goes to review, with no
-- wallet or ledger write.
DO $$
DECLARE
  v_wallet text := pg_temp.wallet(8);
  v_result jsonb := pg_temp.flip(8);
BEGIN
  PERFORM pg_temp.check(v_result->>'status' = 'refused' AND v_result->>'reason' = 'not_migrating',
    'a legacy wallet must not flip: ' || v_result::text);
  PERFORM pg_temp.check(pg_temp.state(8) = 'legacy', 'a refused flip leaves the wallet legacy');
  PERFORM pg_temp.check(pg_temp.wallet(8) = v_wallet AND pg_temp.ledger_rows(8) = 0,
    'a refused flip must not write the wallet or ledger');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing
    WHERE customer_id = pg_temp.c(8) AND review_reason = 'flip_not_migrating'),
    'a refused flip is flagged for review');
  PERFORM pg_temp.check(pg_temp.flip(2)->>'changed' = 'false',
    'an audited-zero wallet is already backed: the flip is a no-op');
  PERFORM pg_temp.expect_error(format(
    'SELECT piggyvest_primary.flip_to_backed(%L, %L, %L)', pg_temp.c(1), pg_temp.m(1), 'bad ref'),
    '22023', 'wallet_backing_invalid_move_reference');
  PERFORM pg_temp.expect_error(format(
    'SELECT piggyvest_primary.flip_to_backed(%L, %L, %L)', pg_temp.c(1), pg_temp.id(2), 'pvb-wt-x-1'),
    '42501', 'wallet_backing_scope_unavailable');
END $$;

-- A review-flagged legacy row (customer 8, above) can still begin, in place:
-- the update path keeps the row and its flag. Rolled back so customer 8 stays
-- legacy for the later parts.
SAVEPOINT wallet_backing_flagged_begin;
DO $$
DECLARE
  v_flagged piggyvest_primary.wallet_backing%ROWTYPE;
  v_after piggyvest_primary.wallet_backing%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_flagged FROM piggyvest_primary.wallet_backing WHERE customer_id = pg_temp.c(8);
  v_result := pg_temp.begin_move(8, 250.00);
  SELECT * INTO v_after FROM piggyvest_primary.wallet_backing WHERE customer_id = pg_temp.c(8);
  PERFORM pg_temp.check(v_result->>'status' = 'migrating' AND (v_result->>'changed')::boolean
    AND (v_result->>'backingId')::uuid = v_flagged.id, 'a flagged legacy row begins in place: ' || v_result::text);
  PERFORM pg_temp.check(v_after.onboarding_intent_id = pg_temp.i(8) AND v_after.audited_amount = 250.00
    AND v_after.migrating_at IS NOT NULL AND v_after.review_reason = 'flip_not_migrating'
    AND v_after.review_flagged_at = v_flagged.review_flagged_at, 'begin records the move and keeps the flag');
  PERFORM pg_temp.check(pg_temp.events(8) = 2 AND pg_temp.ledger_rows(8) = 0,
    'one migration_begun event, no ledger write');
END $$;
ROLLBACK TO SAVEPOINT wallet_backing_flagged_begin;

SAVEPOINT wallet_backing_flagged_zero;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  UPDATE public.customer_wallets SET available_balance = 0 WHERE customer_id = pg_temp.c(8);
  v_result := pg_temp.begin_move(8, 0);
  PERFORM pg_temp.check(v_result->>'status' = 'backed' AND (v_result->>'changed')::boolean,
    'a flagged zero wallet goes to backed: ' || v_result::text);
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing WHERE customer_id = pg_temp.c(8)
    AND backed_via = 'audited_zero' AND migrating_at IS NULL AND review_reason = 'flip_not_migrating'),
    'an audited zero through the update path');
END $$;
ROLLBACK TO SAVEPOINT wallet_backing_flagged_zero;

-- The clean move: backed first, then exactly one relabel pair with the
-- balance unchanged at the audited amount.
DO $$
DECLARE
  v_wallet text := pg_temp.wallet(1);
  v_rows bigint := pg_temp.ledger_rows(1);
  v_result jsonb := pg_temp.flip(1);
  v_backing piggyvest_primary.wallet_backing%ROWTYPE;
BEGIN
  PERFORM pg_temp.check(v_result->>'status' = 'backed' AND (v_result->>'changed')::boolean
    AND (v_result->>'relabelledAmount')::numeric = 1500.00, 'a migrating wallet must flip: ' || v_result::text);
  PERFORM pg_temp.check(v_result->'hooks' = '{"creditDeferred":"noop","convertObligations":"noop"}'::jsonb,
    'the shipped hooks are no-ops: ' || v_result::text);
  PERFORM pg_temp.check((SELECT count(*) FROM relabel_seen) = 2
    AND NOT EXISTS (SELECT 1 FROM relabel_seen WHERE state <> 'backed'),
    'the wallet must be backed before either relabel row is written');
  PERFORM pg_temp.check(pg_temp.wallet(1) = v_wallet, 'the flip must not write customer_wallets');
  PERFORM pg_temp.check((SELECT available_balance FROM public.customer_wallets
    WHERE customer_id = pg_temp.c(1)) = 1500.00, 'available_balance stays at the audited amount');
  PERFORM pg_temp.check(pg_temp.ledger_rows(1) = v_rows + 2 AND pg_temp.relabel_rows(1) = 2,
    'the flip writes exactly one relabel pair');
  SELECT * INTO v_backing FROM piggyvest_primary.wallet_backing WHERE customer_id = pg_temp.c(1);
  PERFORM pg_temp.check(v_backing.state = 'backed' AND v_backing.backed_via = 'confirmed_move'
    AND v_backing.move_reference = 'pvb-wt-' || pg_temp.c(1)::text || '-1'
    AND v_backing.audited_amount = 1500.00, 'the flip records the confirmed move');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
    WHERE t.source_id = v_backing.id AND t.metadata->>'leg' = 'legacy_out' AND t.type = 'adjustment'
      AND t.amount = -1500.00 AND t.balance_after = 0 AND t.status = 'completed'),
    'the legacy-out leg is -X');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
    WHERE t.source_id = v_backing.id AND t.metadata->>'leg' = 'piggyvest_in' AND t.type = 'adjustment'
      AND t.amount = 1500.00 AND t.balance_after = 1500.00 AND t.status = 'completed'),
    'the piggyvest-in leg is +X');
  -- Ledger rebuilds (backfill_wallet_balances adds adjustment amounts) net to zero.
  PERFORM pg_temp.check((SELECT sum(t.amount) FROM public.customer_wallet_transactions t
    WHERE t.source_type = 'piggyvest_legacy_migration' AND t.source_id = v_backing.id) = 0,
    'the relabel pair nets to zero');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing_events e
    WHERE e.backing_id = v_backing.id AND e.event = 'backed_confirmed_move'
      AND e.from_state = 'migrating' AND e.to_state = 'backed' AND e.amount = 1500.00),
    'the flip records its event');
  PERFORM pg_temp.check(piggyvest_primary.is_backed(pg_temp.c(1), pg_temp.m(1)), 'customer 1 is backed');

  -- A second flip (a replayed settle) writes nothing.
  v_result := pg_temp.flip(1);
  PERFORM pg_temp.check(v_result->>'status' = 'backed' AND NOT (v_result->>'changed')::boolean,
    'a second flip must be a no-op: ' || v_result::text);
  PERFORM pg_temp.check(pg_temp.relabel_rows(1) = 2 AND pg_temp.events(1) = 2
    AND (SELECT count(*) FROM relabel_seen) = 2, 'flipping twice writes one pair');
  PERFORM pg_temp.check(pg_temp.begin_move(1, 1500)->>'status' = 'backed', 'begin on backed is a no-op');
  PERFORM pg_temp.check(pg_temp.relabel_rows(1) = 2 AND pg_temp.events(1) = 2,
    'begin on a backed wallet writes nothing');
END $$;

-- The largest amount the ledger row holds flips cleanly: the pair fits.
DO $$
DECLARE
  v_result jsonb := pg_temp.flip(13);
BEGIN
  PERFORM pg_temp.check(v_result->>'status' = 'backed'
    AND (v_result->>'relabelledAmount')::numeric = 99999999.99, 'the boundary amount must flip: ' || v_result::text);
  PERFORM pg_temp.check((SELECT count(*) FROM public.customer_wallet_transactions t
    WHERE t.customer_id = pg_temp.c(13) AND t.source_type = 'piggyvest_legacy_migration'
      AND abs(t.amount) = 99999999.99) = 2, 'the boundary pair is written in full');
END $$;

-- A pending legacy row written while migrating (balance unchanged) never
-- flips either; rolled back so the mismatch case below sees no pending row.
SAVEPOINT wallet_backing_flip_pending;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  INSERT INTO public.customer_wallet_transactions(wallet_id, customer_id, merchant_id, type, amount,
    balance_after, source_type, source_id, status, description)
  SELECT w.id, w.customer_id, w.merchant_id, 'redemption', 50.00, 900.00,
    'piggyvest_primary_savings', pg_temp.id(700), 'pending', 'Savings redemption pending'
  FROM public.customer_wallets w WHERE w.customer_id = pg_temp.c(7);
  v_result := pg_temp.flip(7);
  PERFORM pg_temp.check(v_result->>'status' = 'review' AND v_result->>'reason' = 'pending_ledger',
    'a pending row must not flip: ' || v_result::text);
  PERFORM pg_temp.check(pg_temp.state(7) = 'migrating' AND pg_temp.relabel_rows(7) = 0,
    'a pending flip stays migrating and writes no relabel rows');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing
    WHERE customer_id = pg_temp.c(7) AND review_reason = 'flip_pending_ledger'), 'the pending row is flagged');
END $$;
ROLLBACK TO SAVEPOINT wallet_backing_flip_pending;

-- A balance that changed while migrating (an unfenced legacy write) never
-- flips: the wallet stays migrating and goes to review, ledger untouched.
DO $$
DECLARE
  v_result jsonb;
BEGIN
  UPDATE public.customer_wallets SET available_balance = 850.00 WHERE customer_id = pg_temp.c(7);
  v_result := pg_temp.flip(7);
  PERFORM pg_temp.check(v_result->>'status' = 'review' AND v_result->>'reason' = 'balance_mismatch',
    'a changed balance must not flip: ' || v_result::text);
  PERFORM pg_temp.check(pg_temp.state(7) = 'migrating', 'a reviewed flip stays migrating');
  PERFORM pg_temp.check(pg_temp.relabel_rows(7) = 0, 'a reviewed flip writes no relabel rows');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing
    WHERE customer_id = pg_temp.c(7) AND review_reason = 'flip_balance_mismatch'
      AND review_flagged_at IS NOT NULL), 'the mismatch is flagged for review');
END $$;

-- Review and refusal outcomes are returned, never raised, even when the
-- customer row no longer matches: a customer that does not exist (an account
-- deleted before any migration) is refused without a flag, and a migrating
-- wallet whose customer row moved merchant still goes to review.
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := piggyvest_primary.flip_to_backed(pg_temp.id(299), pg_temp.id(1), 'pvb-wt-gone-1');
  PERFORM pg_temp.check(v_result->>'status' = 'refused' AND v_result->>'reason' = 'not_migrating',
    'a missing customer is refused, not raised: ' || v_result::text);
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing
    WHERE customer_id = pg_temp.id(299)), 'a missing customer records nothing');
  BEGIN
    UPDATE public.customers SET merchant_id = pg_temp.id(2) WHERE id = pg_temp.c(7);
    v_result := pg_temp.flip(7);
    PERFORM pg_temp.check(v_result->>'status' = 'review' AND pg_temp.relabel_rows(7) = 0,
      'a moved customer row still reviews, not raises: ' || v_result::text);
    RAISE EXCEPTION USING ERRCODE = 'ZFLP1';
  EXCEPTION WHEN SQLSTATE 'ZFLP1' THEN NULL;
  END;
END $$;

-- A zero flip (no wallet row, audited zero) moves to backed and writes no
-- wallet or ledger row.
DO $$
DECLARE
  v_result jsonb;
BEGIN
  INSERT INTO piggyvest_primary.wallet_backing(merchant_id, customer_id, state,
    onboarding_intent_id, audited_amount, migrating_at)
  VALUES (pg_temp.m(11), pg_temp.c(11), 'migrating', pg_temp.i(11), 0, clock_timestamp());
  v_result := pg_temp.flip(11);
  PERFORM pg_temp.check(v_result->>'status' = 'backed' AND (v_result->>'relabelledAmount')::numeric = 0,
    'a zero flip must back the wallet: ' || v_result::text);
  PERFORM pg_temp.check(pg_temp.wallet(11) = 'none' AND pg_temp.ledger_rows(11) = 0,
    'a zero flip writes no wallet or ledger row');
END $$;

DROP TRIGGER wallet_backing_suite_observe_relabel ON public.customer_wallet_transactions;
