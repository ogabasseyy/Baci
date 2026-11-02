-- Part of piggyvest_primary_wallet_backing.sql (\ir): flip_to_backed review
-- outcomes (relinked user, existing or failing relabel write). Runs inside the
-- entry file's transaction, after flip.inc; not a standalone suite. Customers
-- 7 and 9 are migrating and untouched; every case rolls back.

-- The onboarding intent belongs to the user the customer row named at begin.
-- A relink (a different user, or none) between begin and flip, with the
-- balance unchanged, reviews: the wallet must not be backed against the
-- previous user's provider wallet. Customer 7 is migrating and untouched.
DO $$
DECLARE
  v_result jsonb;
BEGIN
  BEGIN
    INSERT INTO auth.users(id) VALUES (pg_temp.id(190));
    UPDATE public.customers SET user_id = pg_temp.id(190) WHERE id = pg_temp.c(7);
    v_result := pg_temp.flip(7);
    PERFORM pg_temp.check(v_result->>'status' = 'review' AND v_result->>'reason' = 'user_mismatch'
      AND pg_temp.state(7) = 'migrating' AND pg_temp.relabel_rows(7) = 0 AND EXISTS (
        SELECT 1 FROM piggyvest_primary.wallet_backing
        WHERE customer_id = pg_temp.c(7) AND review_reason = 'flip_user_mismatch'),
      'a relinked user must review, never flip: ' || v_result::text);
    RAISE EXCEPTION USING ERRCODE = 'ZFLU1';
  EXCEPTION WHEN SQLSTATE 'ZFLU1' THEN NULL;
  END;
  BEGIN
    UPDATE public.customers SET user_id = NULL WHERE id = pg_temp.c(7);
    v_result := pg_temp.flip(7);
    PERFORM pg_temp.check(v_result->>'status' = 'review' AND v_result->>'reason' = 'user_mismatch'
      AND pg_temp.state(7) = 'migrating' AND pg_temp.relabel_rows(7) = 0,
      'an unlinked user must review, never flip: ' || v_result::text);
    RAISE EXCEPTION USING ERRCODE = 'ZFLU2';
  EXCEPTION WHEN SQLSTATE 'ZFLU2' THEN NULL;
  END;
  PERFORM pg_temp.check(pg_temp.state(7) = 'migrating', 'the relink cases roll back');
END $$;

-- A relabel leg that already exists for this backing row (the ledger is
-- writable by other paths) is returned as a review, never raised: the
-- backed update and any partial pair roll back, so the wallet stays migrating.
DO $$
DECLARE
  v_result jsonb;
BEGIN
  BEGIN
    INSERT INTO public.customer_wallet_transactions(wallet_id, customer_id, merchant_id, type, amount,
      balance_after, source_type, source_id, status, description)
    SELECT w.id, w.customer_id, w.merchant_id, 'adjustment', 400.00, 400.00,
      'piggyvest_legacy_migration', b.id, 'completed', 'Pre-existing leg'
    FROM public.customer_wallets w JOIN piggyvest_primary.wallet_backing b ON b.customer_id = w.customer_id
    WHERE w.customer_id = pg_temp.c(9);
    v_result := pg_temp.flip(9);
    PERFORM pg_temp.check(v_result->>'status' = 'review' AND v_result->>'reason' = 'relabel_conflict',
      'an existing leg must review, not raise: ' || v_result::text);
    PERFORM pg_temp.check(pg_temp.state(9) = 'migrating' AND pg_temp.relabel_rows(9) = 1
      AND NOT EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing_events e
        JOIN piggyvest_primary.wallet_backing b ON b.id = e.backing_id
        WHERE b.customer_id = pg_temp.c(9) AND e.event = 'backed_confirmed_move')
      AND EXISTS (SELECT 1 FROM piggyvest_primary.wallet_backing
        WHERE customer_id = pg_temp.c(9) AND review_reason = 'flip_relabel_conflict'
          AND backed_via IS NULL AND move_reference IS NULL),
      'the conflicting flip writes nothing, stays migrating and is flagged');
    RAISE EXCEPTION USING ERRCODE = 'ZFLR1';
  EXCEPTION WHEN SQLSTATE 'ZFLR1' THEN NULL;
  END;
  PERFORM pg_temp.check(pg_temp.state(9) = 'migrating' AND pg_temp.relabel_rows(9) = 0,
    'the conflict case rolls back');
END $$;

-- Any other failure while the pair is written (a trigger or constraint on the
-- ledger objecting) is returned as a review too, with nothing left behind.
CREATE FUNCTION pg_temp.refuse_relabel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_type = 'piggyvest_legacy_migration' THEN
    RAISE EXCEPTION 'ledger refuses relabel' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  v_result jsonb;
BEGIN
  BEGIN
    CREATE TRIGGER wallet_backing_suite_refuse_relabel
      BEFORE INSERT ON public.customer_wallet_transactions
      FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_relabel();
    v_result := pg_temp.flip(9);
    PERFORM pg_temp.check(v_result->>'status' = 'review' AND v_result->>'reason' = 'relabel_failed'
      AND pg_temp.state(9) = 'migrating' AND pg_temp.relabel_rows(9) = 0 AND EXISTS (
        SELECT 1 FROM piggyvest_primary.wallet_backing
        WHERE customer_id = pg_temp.c(9) AND review_reason = 'flip_relabel_failed'),
      'a failing ledger write must review, not raise: ' || v_result::text);
    RAISE EXCEPTION USING ERRCODE = 'ZFLR2';
  EXCEPTION WHEN SQLSTATE 'ZFLR2' THEN NULL;
  END;
  PERFORM pg_temp.check(pg_temp.state(9) = 'migrating', 'the failing-write case rolls back');
END $$;
