-- Serialize failed-VTU retry claims against refund issuance.
--
-- Codex R114: a failed row's retry claim (status flip failed -> processing)
-- and a concurrent refund RPC both gated on a stale in-memory read. The
-- claim's fenced UPDATE serialized claim-vs-claim, but refund-vs-claim was
-- unserialized: refund commits -> claim flips -> retry re-vends on top of
-- restored value (double value: refund + vend).
--
-- Fix: both sides now serialize on the vtu_transactions row lock inside
-- SECURITY DEFINER RPCs (one commit order; the loser sees the winner):
--
--   1. refund_customer_wallet_for_vtu / reverse_vtu_wallet_payment accept
--      p_expected_status (default NULL = legacy behavior for old callers).
--      When set, the RPC locks the VTU row and RAISES (42501, like the
--      merchant-mismatch refusal) unless the row still has that status.
--      RAISE (not a flag) because callers treat RPC errors as "no refund
--      issued" and ignore the success flag.
--   2. claim_failed_vtu_retry locks the row, refuses unless status is
--      still 'failed', and refuses when the LEDGER already holds a card-
--      leg refund or wallet-leg reversal for the row. The ledger (not the
--      metadata flag) is the money authority: flag-only rows with no
--      ledger row credited nothing, so they stay retryable.
--
-- Lock order is advisory -> tx row -> wallet row on both refund RPCs and
-- tx row only on the claim RPC, so no lock cycle is possible.
--
-- The claim's ledger EXISTS filters on (source_id, source_type, type)
-- without customer/merchant (source-only matches the reversal RPC's own
-- idempotency semantics and catches even mis-scoped rows), so it cannot
-- use the leading customer_id edge of idx_customer_wallet_transactions_
-- idempotency. Cover it directly; one narrow btree, built once.

CREATE INDEX IF NOT EXISTS idx_customer_wallet_transactions_vtu_refund_source
  ON public.customer_wallet_transactions (
    source_id,
    source_type,
    type
  );

DROP FUNCTION IF EXISTS public.refund_customer_wallet_for_vtu(uuid, uuid, numeric, uuid, text);

CREATE OR REPLACE FUNCTION public.refund_customer_wallet_for_vtu(
  p_customer_id uuid,
  p_merchant_id uuid,
  p_amount numeric,
  p_vtu_transaction_id uuid,
  p_description text DEFAULT NULL::text,
  p_expected_status text DEFAULT NULL::text
) RETURNS TABLE(success boolean, new_balance numeric, transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_wallet_id uuid;
  v_new_balance numeric;
  v_transaction_id uuid;
  v_tx_status text;
  v_source_type constant text := 'vtu_transaction_refund';
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'refund_customer_wallet_for_vtu amount must be greater than zero'
      USING ERRCODE = '22023';
  END IF;

  IF p_vtu_transaction_id IS NULL THEN
    RAISE EXCEPTION 'refund_customer_wallet_for_vtu requires a vtu transaction id'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = p_customer_id AND c.merchant_id = p_merchant_id
  ) THEN
    RAISE EXCEPTION 'Customer does not belong to merchant'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent refunds for the same VTU transaction so we don't
  -- race two simultaneous fulfillment retries into a duplicate ledger row.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'customer_wallet:' || v_source_type || ':' || p_vtu_transaction_id::text,
      0
    )
  );

  -- Idempotency: if this VTU transaction was already refunded (manual replay
  -- of a webhook, retried mobile poll, etc.) return the existing balance
  -- snapshot instead of crediting again.
  SELECT
    cwt.wallet_id,
    cwt.balance_after,
    cwt.id
  INTO v_wallet_id, v_new_balance, v_transaction_id
  FROM public.customer_wallet_transactions cwt
  WHERE
    cwt.customer_id = p_customer_id
    AND cwt.merchant_id = p_merchant_id
    AND cwt.source_type = v_source_type
    AND cwt.source_id = p_vtu_transaction_id
    AND cwt.type = 'refund'
  ORDER BY cwt.created_at DESC
  LIMIT 1;

  IF v_transaction_id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_new_balance, v_transaction_id;
    RETURN;
  END IF;

  -- Lost-update guard: the caller passes the VTU row status it gated on
  -- (usually 'failed'). The row lock serializes against
  -- claim_failed_vtu_retry's status flip; refuse when the row moved (a
  -- concurrent retry claimed it) or is missing. NULL keeps legacy
  -- behavior for callers that predate the guard.
  IF p_expected_status IS NOT NULL THEN
    SELECT t.status INTO v_tx_status
    FROM public.vtu_transactions t
    WHERE t.id = p_vtu_transaction_id
    FOR UPDATE;

    IF v_tx_status IS DISTINCT FROM p_expected_status THEN
      RAISE EXCEPTION 'VTU transaction status changed under refund (expected %, found %)',
        p_expected_status, v_tx_status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A refund credits available_balance but does NOT add to total_earned —
  -- that ledger column tracks legitimate cashback/bonus history, not
  -- compensation for a failed payment.
  INSERT INTO public.customer_wallets (
    customer_id,
    merchant_id,
    available_balance,
    total_earned
  )
  VALUES (p_customer_id, p_merchant_id, p_amount, 0)
  ON CONFLICT (customer_id) DO UPDATE SET
    available_balance =
      public.customer_wallets.available_balance + EXCLUDED.available_balance,
    updated_at = now()
  RETURNING id, available_balance INTO v_wallet_id, v_new_balance;

  INSERT INTO public.customer_wallet_transactions (
    wallet_id,
    customer_id,
    merchant_id,
    type,
    status,
    amount,
    balance_after,
    source_type,
    source_id,
    description
  )
  VALUES (
    v_wallet_id,
    p_customer_id,
    p_merchant_id,
    'refund',
    'completed',
    p_amount,
    v_new_balance,
    v_source_type,
    p_vtu_transaction_id,
    COALESCE(p_description, 'VTU vend failed — payment refunded to wallet')
  )
  RETURNING id INTO v_transaction_id;

  RETURN QUERY SELECT true, v_new_balance, v_transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_customer_wallet_for_vtu(uuid, uuid, numeric, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_customer_wallet_for_vtu(uuid, uuid, numeric, uuid, text, text) TO service_role;

DROP FUNCTION IF EXISTS public.reverse_vtu_wallet_payment(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.reverse_vtu_wallet_payment(
  p_vtu_transaction_id uuid,
  p_reason text DEFAULT 'VTU vend failed'::text,
  p_merchant_id uuid DEFAULT NULL,
  p_expected_status text DEFAULT NULL::text
) RETURNS TABLE(
  success boolean,
  reversed_amount numeric,
  new_balance numeric,
  reversal_transaction_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_original_tx record;
  v_new_balance numeric;
  v_reversal_tx_id uuid;
  v_tx_status text;
BEGIN
  IF p_vtu_transaction_id IS NULL THEN
    RAISE EXCEPTION 'reverse_vtu_wallet_payment p_vtu_transaction_id is required'
      USING ERRCODE = '22023';
  END IF;

  -- Same advisory-lock key as redeem_vtu_wallet_payment so a debit and
  -- its reversal serialize on the same VTU transaction.
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(md5(p_vtu_transaction_id::text), 1, 16))::bit(64)::bigint
  );

  -- Lost-update guard (same contract as refund_customer_wallet_for_vtu):
  -- refuse when the VTU row moved off the caller-observed status, so a
  -- retry that already re-claimed the row is never reversed under. This
  -- MUST run before the wallet-row SELECT below: both refund RPCs must
  -- acquire row locks in the same order (VTU row, then wallet row) —
  -- they use different advisory keys, so opposite ordering can deadlock
  -- two concurrent workers (Codex R115 P2). A reversed row can never
  -- move again (the retry-claim RPC refuses ledger-credited rows), so
  -- checking before the idempotency early-return cannot misfire.
  IF p_expected_status IS NOT NULL THEN
    SELECT t.status INTO v_tx_status
    FROM public.vtu_transactions t
    WHERE t.id = p_vtu_transaction_id
    FOR UPDATE;

    IF v_tx_status IS DISTINCT FROM p_expected_status THEN
      RAISE EXCEPTION 'VTU transaction status changed under reversal (expected %, found %)',
        p_expected_status, v_tx_status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT t.*, w.available_balance AS current_balance
  INTO v_original_tx
  FROM public.customer_wallet_transactions t
  JOIN public.customer_wallets w ON w.id = t.wallet_id
  WHERE
    t.source_type = 'vtu_wallet_payment'
    AND t.source_id = p_vtu_transaction_id
    AND t.type = 'redemption'
  FOR UPDATE OF w;

  IF v_original_tx IS NULL THEN
    -- new_balance is NULL (not 0) so callers can distinguish "no original
    -- debit existed for this VTU transaction" from "wallet has 0".
    RETURN QUERY SELECT false, 0::numeric, NULL::numeric, NULL::uuid;
    RETURN;
  END IF;

  -- Defense-in-depth merchant scoping. When the caller supplies
  -- p_merchant_id, refuse to reverse a debit that belongs to a different
  -- merchant. NULL-safe via IS DISTINCT FROM.
  IF p_merchant_id IS NOT NULL
    AND v_original_tx.merchant_id IS DISTINCT FROM p_merchant_id THEN
    RAISE EXCEPTION 'Merchant mismatch on VTU wallet reversal'
      USING ERRCODE = '42501';
  END IF;

  -- Idempotency: if we've already reversed this debit, return the
  -- current wallet balance and signal "no-op" via reversal_transaction_id
  -- = NULL. Distinguish from "no original debit" via new_balance being
  -- non-NULL (current wallet balance).
  IF EXISTS (
    SELECT 1 FROM public.customer_wallet_transactions
    WHERE source_type = 'vtu_wallet_reversal'
      AND source_id = p_vtu_transaction_id
  ) THEN
    RETURN QUERY SELECT false, 0::numeric, v_original_tx.current_balance, NULL::uuid;
    RETURN;
  END IF;

  v_new_balance := v_original_tx.current_balance + v_original_tx.amount;

  UPDATE public.customer_wallets
  SET
    available_balance = v_new_balance,
    total_redeemed = GREATEST(total_redeemed - v_original_tx.amount, 0),
    updated_at = now()
  WHERE id = v_original_tx.wallet_id;

  INSERT INTO public.customer_wallet_transactions (
    wallet_id,
    customer_id,
    merchant_id,
    type,
    amount,
    balance_after,
    source_type,
    source_id,
    description
  )
  VALUES (
    v_original_tx.wallet_id,
    v_original_tx.customer_id,
    v_original_tx.merchant_id,
    'adjustment',
    v_original_tx.amount,
    v_new_balance,
    'vtu_wallet_reversal',
    p_vtu_transaction_id,
    p_reason
  )
  RETURNING id INTO v_reversal_tx_id;

  RETURN QUERY SELECT true, v_original_tx.amount, v_new_balance, v_reversal_tx_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_vtu_wallet_payment(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_vtu_wallet_payment(uuid, text, uuid, text) TO service_role;

-- Atomic failed-row retry claim. Locks the VTU row (serializing against
-- the refund RPCs' expected-status check), refuses unless the row is
-- still failed, and refuses when the ledger already restored value for
-- the row — so a refund that committed between the caller's read and this
-- claim can never be followed by a re-vend.
CREATE OR REPLACE FUNCTION public.claim_failed_vtu_retry(
  p_vtu_transaction_id uuid
)
RETURNS TABLE(claimed boolean, refusal_reason text, claimed_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_status text;
  v_updated timestamptz;
BEGIN
  IF p_vtu_transaction_id IS NULL THEN
    RAISE EXCEPTION 'claim_failed_vtu_retry p_vtu_transaction_id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT t.status INTO v_status
  FROM public.vtu_transactions t
  WHERE t.id = p_vtu_transaction_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, 'missing', NULL::timestamptz;
    RETURN;
  END IF;

  IF v_status <> 'failed' THEN
    RETURN QUERY SELECT false, 'status_moved', NULL::timestamptz;
    RETURN;
  END IF;

  -- The ledger is the money authority: a committed card-leg refund OR a
  -- wallet-leg reversal means value was already restored. The metadata
  -- refundIssued flag is deliberately NOT consulted — flag-only rows
  -- with no ledger row credited nothing, so they stay retryable.
  IF EXISTS (
    SELECT 1 FROM public.customer_wallet_transactions
    WHERE source_id = p_vtu_transaction_id
      AND (
        source_type = 'vtu_wallet_reversal'
        OR (source_type = 'vtu_transaction_refund' AND type = 'refund')
      )
  ) THEN
    RETURN QUERY SELECT false, 'already_refunded', NULL::timestamptz;
    RETURN;
  END IF;

  UPDATE public.vtu_transactions
  SET status = 'processing', error_message = NULL, updated_at = now()
  WHERE id = p_vtu_transaction_id
  RETURNING updated_at INTO v_updated;

  RETURN QUERY SELECT true, NULL::text, v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_failed_vtu_retry(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_failed_vtu_retry(uuid) TO service_role;
