-- Durable insufficient-balance decline marker (Codex R37 rktSo follow-up,
-- R38 rlFA4). When `redeem_vtu_wallet_payment` reports insufficient
-- balance, fulfillment persists a failed row — but if that persistence
-- exhausts its retries, the database still holds a reference-less
-- `processing` row with no `walletDebited` flag and a wallet-only split
-- (card === 0): byte-identical to a crash-before-debit strand. The
-- stranded pre-vend predicate would then flip it to pending after five
-- minutes, and a later top-up (for any purpose) would let the cron
-- debit and vend a purchase the customer was told failed — with no new
-- submission. Fulfillment therefore stamps this marker IMMEDIATELY after
-- the decline (adjacent to the provably-live debit RPC, before the
-- refund + failed-payload writes), and the predicate excludes marked
-- rows from automatic re-drive. The patch is a single atomic UPDATE so
-- concurrent metadata writers (replay overlay, voucher backfill) never
-- lose keys to a stale snapshot.
--
-- SECURITY DEFINER is limited to service_role-only decline marking;
-- search_path is pinned to prevent injection through caller schemas.
CREATE OR REPLACE FUNCTION public.mark_vtu_wallet_debit_declined(
  p_transaction_id uuid,
  p_declined_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.vtu_transactions WHERE id = p_transaction_id
  ) THEN
    RAISE EXCEPTION 'VTU transaction % not found while marking debit declined',
      p_transaction_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.vtu_transactions
  SET metadata = COALESCE(metadata, '{}'::jsonb)
    || jsonb_build_object(
      'walletDebitDeclinedInsufficientBalanceAt',
      to_jsonb(p_declined_at)
    )
  WHERE id = p_transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_vtu_wallet_debit_declined(uuid, timestamptz)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_vtu_wallet_debit_declined(uuid, timestamptz)
TO service_role;
