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
