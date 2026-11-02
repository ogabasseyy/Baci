-- PiggyVest legacy migration, step 4/5: the one reviewed SQL update.
-- Sets each listed old wallet to zero and records the amount, date and the
-- PiggyVest credit reference in the wallet ledger. Owner runs it, never an agent.
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f 02-zero-out.sql
--
-- Rules this script enforces (it aborts the whole transaction on any breach):
--   * the list must not be empty and must hold exactly the declared row count;
--   * a wallet with any pending ledger row is refused (its balance can still
--     change when that row is confirmed or released);
--   * every listed wallet must exist, match its merchant and customer, and hold
--     EXACTLY the expected balance at the moment it is locked;
--   * a wallet that already has a migration ledger row is refused (no second run);
--   * every wallet is changed, nothing else is touched.
-- It ends with ROLLBACK. Read the printed result, then swap the last two lines
-- (delete ROLLBACK, uncomment the final COMMIT) and run it again. Nothing is
-- saved until then.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE legacy_zero_out_list (
  wallet_id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  expected_balance numeric(12,2) NOT NULL
    CHECK (expected_balance > 0 AND expected_balance <= 99999999.99),
  piggyvest_credit_reference text NOT NULL
    CHECK (length(btrim(piggyvest_credit_reference)) > 0)
) ON COMMIT DROP;

CREATE TEMP TABLE legacy_zero_out_declared (
  expected_rows integer NOT NULL CHECK (expected_rows > 0)
) ON COMMIT DROP;

-- >>> REVIEWED ROWS BELOW (one per customer, copied from the signed-off list)
-- Declare how many customers the signed list holds, then load them in ONE
-- multi-row INSERT (never several separate INSERT statements).
-- INSERT INTO legacy_zero_out_declared (expected_rows) VALUES (1);
-- INSERT INTO legacy_zero_out_list
--   (wallet_id, merchant_id, customer_id, expected_balance, piggyvest_credit_reference)
-- VALUES
--   ('<wallet uuid>', '<merchant uuid>', '<customer uuid>', 0.00, '<PiggyVest credit reference>');
-- <<< REVIEWED ROWS ABOVE

DO $$
DECLARE
  v_expected integer;
  v_locked integer;
  v_bad integer;
  v_done integer;
  v_now timestamptz;
  v_declared integer;
BEGIN
  SELECT count(*) INTO v_expected FROM legacy_zero_out_list;
  IF v_expected = 0 THEN
    RAISE EXCEPTION 'legacy zero-out list is empty';
  END IF;

  SELECT d.expected_rows INTO v_declared FROM legacy_zero_out_declared d;
  IF v_declared IS NULL THEN
    RAISE EXCEPTION 'declared row count is missing';
  END IF;
  IF v_declared IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'row count mismatch: % declared, % loaded', v_declared, v_expected;
  END IF;

  -- Lock every listed wallet in a fixed order before reading any value.
  PERFORM 1
  FROM public.customer_wallets cw
  JOIN legacy_zero_out_list l ON l.wallet_id = cw.id
  ORDER BY cw.id
  FOR UPDATE OF cw;
  GET DIAGNOSTICS v_locked = ROW_COUNT;
  IF v_locked <> v_expected THEN
    RAISE EXCEPTION 'wallet missing: % listed, % found', v_expected, v_locked;
  END IF;

  -- Re-checked after the locks: merchant, customer and exact balance.
  SELECT count(*) INTO v_bad
  FROM legacy_zero_out_list l
  JOIN public.customer_wallets cw ON cw.id = l.wallet_id
  WHERE cw.merchant_id IS DISTINCT FROM l.merchant_id
     OR cw.customer_id IS DISTINCT FROM l.customer_id
     OR cw.available_balance IS DISTINCT FROM l.expected_balance;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'balance or owner mismatch on % wallet(s); nothing changed', v_bad;
  END IF;

  -- A pending row (reservation, redemption) can still credit the wallet back.
  IF EXISTS (
    SELECT 1
    FROM public.customer_wallet_transactions t
    JOIN legacy_zero_out_list l ON l.wallet_id = t.wallet_id
    WHERE t.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'wallet has a pending ledger row; exclude it and retry later';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.customer_wallet_transactions t
    JOIN legacy_zero_out_list l ON l.wallet_id = t.wallet_id
    WHERE t.source_type = 'piggyvest_legacy_migration'
  ) THEN
    RAISE EXCEPTION 'wallet already migrated; refusing a second run';
  END IF;

  -- Time is read only now that every lock is held.
  v_now := clock_timestamp();

  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, status, description, metadata, created_at
  )
  SELECT
    l.wallet_id, l.customer_id, l.merchant_id, 'debit', l.expected_balance, 0,
    'piggyvest_legacy_migration', 'completed',
    'Moved to PiggyVest wallet (manual credit)',
    jsonb_build_object(
      'migrated_amount', l.expected_balance,
      'migrated_on', v_now,
      'piggyvest_credit_reference', l.piggyvest_credit_reference
    ),
    v_now
  FROM legacy_zero_out_list l;
  GET DIAGNOSTICS v_done = ROW_COUNT;
  IF v_done <> v_expected THEN
    RAISE EXCEPTION 'ledger rows written: % of %', v_done, v_expected;
  END IF;

  UPDATE public.customer_wallets cw
  SET available_balance = 0
  FROM legacy_zero_out_list l
  WHERE cw.id = l.wallet_id
    AND cw.available_balance = l.expected_balance;
  GET DIAGNOSTICS v_done = ROW_COUNT;
  IF v_done <> v_expected THEN
    RAISE EXCEPTION 'wallets zeroed: % of %', v_done, v_expected;
  END IF;
END
$$;

-- Result to review: every row must show now_balance 0.
SELECT
  cw.id AS wallet_id,
  l.expected_balance AS migrated_amount,
  cw.available_balance AS now_balance,
  l.piggyvest_credit_reference
FROM legacy_zero_out_list l
JOIN public.customer_wallets cw ON cw.id = l.wallet_id
ORDER BY cw.id;

ROLLBACK;
-- COMMIT;
