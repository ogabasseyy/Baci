-- Part of piggyvest_primary_wallet_backing.sql (\ir): the pre-declared hooks.
-- Runs inside the entry file's transaction; not a standalone suite.

-- As shipped: every hook is a no-op that writes nothing, and the onboarding
-- hook reports itself not ready (P8 replaces both).
DO $$
DECLARE
  v_backing uuid := (SELECT id FROM piggyvest_primary.wallet_backing WHERE customer_id = pg_temp.c(1));
  v_events bigint := (SELECT count(*) FROM piggyvest_primary.wallet_backing_events);
  v_ledger bigint := (SELECT count(*) FROM public.customer_wallet_transactions);
BEGIN
  PERFORM pg_temp.check(piggyvest_primary.on_onboarding_verified(pg_temp.i(8)) = 'noop',
    'on_onboarding_verified must be a no-op');
  PERFORM pg_temp.check(piggyvest_primary.onboarding_verified_hook_ready() = false,
    'onboarding_verified_hook_ready() must be false until P8 replaces the hook');
  PERFORM pg_temp.check(piggyvest_primary.on_backed_flip_credit_deferred(v_backing) = 'noop',
    'on_backed_flip_credit_deferred must be a no-op');
  PERFORM pg_temp.check(piggyvest_primary.on_backed_flip_convert_obligations(v_backing) = 'noop',
    'on_backed_flip_convert_obligations must be a no-op');
  PERFORM pg_temp.check(pg_temp.state(8) = 'legacy', 'the onboarding hook must not migrate anything');
  PERFORM pg_temp.check((SELECT count(*) FROM piggyvest_primary.wallet_backing_events) = v_events
    AND (SELECT count(*) FROM public.customer_wallet_transactions) = v_ledger,
    'the shipped hooks must write nothing');
END $$;

-- Replacement hooks run once per flip, after the pair is written; a raising
-- hook is contained: the flip, its pair and the confirmed move stand, and the
-- wallet goes to review. The stubs are rolled back with the savepoint.
SAVEPOINT wallet_backing_hook_stubs;

CREATE TEMP TABLE hook_calls(hook text, backing_id uuid, relabel_rows bigint) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION piggyvest_primary.on_backed_flip_credit_deferred(p_backing_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO pg_temp.hook_calls VALUES ('credit_deferred', p_backing_id,
    (SELECT count(*) FROM public.customer_wallet_transactions
     WHERE source_type = 'piggyvest_legacy_migration' AND source_id = p_backing_id));
  RETURN 'recorded';
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.on_backed_flip_convert_obligations(p_backing_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO pg_temp.hook_calls VALUES ('convert_obligations', p_backing_id, NULL);
  IF (SELECT customer_id FROM piggyvest_primary.wallet_backing WHERE id = p_backing_id)
    = 'b5c00000-0000-4000-8000-000000000212'::uuid THEN
    RAISE EXCEPTION 'obligation conversion failed';
  END IF;
  RETURN 'recorded';
END $$;

DO $$
DECLARE
  v_result jsonb := pg_temp.flip(9);
  v_backing uuid := (SELECT id FROM piggyvest_primary.wallet_backing WHERE customer_id = pg_temp.c(9));
BEGIN
  PERFORM pg_temp.check(v_result->'hooks' = '{"creditDeferred":"recorded","convertObligations":"recorded"}'::jsonb,
    'the flip must call both hooks: ' || v_result::text);
  PERFORM pg_temp.check((SELECT count(*) FROM hook_calls WHERE backing_id = v_backing) = 2
    AND (SELECT relabel_rows FROM hook_calls WHERE hook = 'credit_deferred') = 2,
    'each hook runs once, after the relabel pair is written');
  PERFORM pg_temp.check(pg_temp.flip(9)->>'changed' = 'false', 'a second flip is a no-op');
  PERFORM pg_temp.check((SELECT count(*) FROM hook_calls WHERE backing_id = v_backing) = 2,
    'a second flip must not call the hooks again');

  v_result := pg_temp.flip(12);
  PERFORM pg_temp.check(v_result->>'status' = 'backed'
    AND v_result->'hooks' = '{"creditDeferred":"recorded","convertObligations":"error"}'::jsonb,
    'a raising hook must not undo the flip: ' || v_result::text);
  PERFORM pg_temp.check(pg_temp.state(12) = 'backed' AND pg_temp.relabel_rows(12) = 2
    AND (SELECT available_balance FROM public.customer_wallets WHERE customer_id = pg_temp.c(12)) = 600.00,
    'the flip, its pair and the balance stand when a hook raises');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing
    WHERE customer_id = pg_temp.c(12) AND review_reason = 'flip_hook_error'),
    'a raising hook flags the wallet for review');
END $$;

ROLLBACK TO SAVEPOINT wallet_backing_hook_stubs;

DO $$
BEGIN
  PERFORM pg_temp.check(pg_temp.state(9) = 'migrating' AND pg_temp.state(12) = 'migrating',
    'the stub flips are rolled back with their savepoint');
  PERFORM pg_temp.check(piggyvest_primary.on_backed_flip_convert_obligations(pg_temp.id(1)) = 'noop',
    'the shipped hooks are restored');
END $$;
