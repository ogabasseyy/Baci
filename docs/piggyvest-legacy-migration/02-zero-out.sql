-- PiggyVest legacy migration, step 4/5: the one reviewed SQL update.
-- Sets each listed old wallet to zero and records the amount, date and the
-- PiggyVest credit reference in the wallet ledger. Owner runs it, never an agent.
--   dry run (always ROLLBACK):
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f 02-zero-out.sql
--   real run (COMMIT; refuses placeholder references such as DRY-RUN-1):
--     psql -v ON_ERROR_STOP=1 -v zero_out_mode=commit "$DATABASE_URL" -f 02-zero-out.sql
--   Run the same unmodified file both times; never edit it to commit.
--
-- Rules this script enforces (it aborts the whole transaction on any breach):
--   * the list must not be empty and must hold exactly the declared row count
--     (exactly one declared row is allowed);
--   * a PiggyVest credit reference may appear once, and never again after use;
--   * a wallet with any pending ledger row is refused (its balance can still
--     change when that row is confirmed or released);
--   * every listed wallet must exist, match its merchant and customer, and hold
--     EXACTLY the expected balance at the moment it is locked;
--   * a wallet that already has a migration ledger row is refused (no second run);
--   * every wallet's stored balance must equal its ledger total (same formula
--     as 01-balance-list.sql and public.backfill_wallet_balances());
--   * every listed wallet's customer must exist in public.customers for the
--     same merchant (the wallet's own ids alone prove nothing);
--   * every wallet is changed, nothing else is touched;
--   * runs are serialised by a transaction advisory lock, taken before the
--     reference and already-migrated checks, so two overlapping runs cannot
--     both pass the same PiggyVest reference check. The second run waits for
--     the first to finish (up to the 5 second lock timeout, then it fails);
--   * the wallet ledger table is locked against new rows (SHARE ROW EXCLUSIVE)
--     for the rest of the transaction, so a writer that adds a ledger row
--     without touching the wallet row first cannot slip past the checks. It
--     waits for in-flight writers (up to the 5 second lock timeout) and
--     blocks new ones until the run ends. A writer that holds a wallet row and
--     then needs the ledger can deadlock with the run; PostgreSQL aborts one
--     of them, and nothing is changed if it is the run.
-- It ends with ROLLBACK unless zero_out_mode=commit is passed. Read the printed
-- result of the dry run first. Nothing is saved until the commit run.
\if :{?zero_out_mode}
\else
  \set zero_out_mode dry_run
\endif

BEGIN;
SELECT set_config('baci.zero_out_mode', :'zero_out_mode', true);

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

-- One PiggyVest credit can zero only one wallet (case and spaces ignored).
CREATE UNIQUE INDEX legacy_zero_out_reference_uq
  ON legacy_zero_out_list (lower(btrim(piggyvest_credit_reference)));

CREATE TEMP TABLE legacy_zero_out_declared (
  expected_rows integer NOT NULL CHECK (expected_rows > 0)
) ON COMMIT DROP;

-- >>> REVIEWED ROWS BELOW (one per customer, copied from the signed-off list)
-- Declare how many rows you load (credited customers only), then load them in ONE
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
  v_decl_rows integer;
  v_mode text;
BEGIN
  v_mode := current_setting('baci.zero_out_mode', true);
  IF v_mode IS NULL OR v_mode NOT IN ('dry_run', 'commit') THEN
    RAISE EXCEPTION 'zero_out_mode must be dry_run or commit, got %', v_mode;
  END IF;

  SELECT count(*) INTO v_expected FROM legacy_zero_out_list;
  IF v_expected = 0 THEN
    RAISE EXCEPTION 'legacy zero-out list is empty';
  END IF;

  SELECT count(*) INTO v_decl_rows FROM legacy_zero_out_declared;
  IF v_decl_rows <> 1 THEN
    RAISE EXCEPTION 'exactly one declared row count is required, found %', v_decl_rows;
  END IF;
  SELECT d.expected_rows INTO v_declared FROM legacy_zero_out_declared d;
  IF v_declared IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'row count mismatch: % declared, % loaded', v_declared, v_expected;
  END IF;

  -- A real run never accepts placeholder references (the dry run may).
  IF v_mode = 'commit' AND EXISTS (
    SELECT 1 FROM legacy_zero_out_list l
    WHERE btrim(l.piggyvest_credit_reference)
      ~* '^(dry[-_ ]?run|placeholder|test|sample|fake|todo|tbd|xxx)'
  ) THEN
    RAISE EXCEPTION 'placeholder PiggyVest reference found; use the real credit reference';
  END IF;

  -- One migration run at a time. Held to the end of the transaction.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('baci:piggyvest_legacy_zero_out', 0)
  );

  -- Fence the ledger: no new ledger rows until this transaction ends.
  LOCK TABLE public.customer_wallet_transactions IN SHARE ROW EXCLUSIVE MODE;

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

  -- The customer must exist for that merchant, like credit_customer_wallet.
  -- Lock the matched customers rows FOR SHARE first so none can be deleted or
  -- moved to another merchant before the wallet updates below.
  PERFORM 1
  FROM public.customers c
  JOIN legacy_zero_out_list l
    ON l.customer_id = c.id AND l.merchant_id = c.merchant_id
  ORDER BY c.id
  FOR SHARE OF c;

  -- Then check every listed row on its own (customer AND merchant together).
  SELECT count(*) INTO v_bad
  FROM legacy_zero_out_list l
  WHERE NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = l.customer_id AND c.merchant_id = l.merchant_id
  );
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'customer not found for the merchant on % wallet(s); nothing changed', v_bad;
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

  -- A reference already recorded for any wallet cannot be reused.
  IF EXISTS (
    SELECT 1
    FROM public.customer_wallet_transactions t
    JOIN legacy_zero_out_list l
      ON lower(btrim(t.metadata ->> 'piggyvest_credit_reference'))
       = lower(btrim(l.piggyvest_credit_reference))
    WHERE t.source_type = 'piggyvest_legacy_migration'
  ) THEN
    RAISE EXCEPTION 'PiggyVest credit reference already used for a migrated wallet';
  END IF;

  -- The stored balance must also equal the ledger total, or zeroing it would
  -- leave the ledger non-zero and a later rebuild would resurrect the money.
  SELECT count(*) INTO v_bad
  FROM legacy_zero_out_list l
  WHERE l.expected_balance IS DISTINCT FROM (
    SELECT COALESCE(SUM(
      CASE
        WHEN t.status = 'completed'
          AND t.type IN ('credit', 'cashback', 'bonus', 'adjustment', 'refund')
          THEN t.amount
        WHEN t.status = 'completed'
          AND t.type IN ('debit', 'redemption', 'expiry')
          THEN -t.amount
        WHEN t.status = 'expired' AND t.type = 'expiry'
          THEN -t.amount
        ELSE 0
      END
    ), 0)
    FROM public.customer_wallet_transactions t
    WHERE t.wallet_id = l.wallet_id
  );
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'ledger total differs from the stored balance on % wallet(s); nothing changed', v_bad;
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
  SET available_balance = 0,
      updated_at = v_now
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

SELECT (:'zero_out_mode' = 'commit') AS do_commit \gset
\if :do_commit
COMMIT;
\else
ROLLBACK;
\endif
