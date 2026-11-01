/**
 * Wire contract with `redeem_vtu_wallet_payment` (Phase B.1 migration).
 * The RPC raises `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE =
 * 'insufficient_wallet_balance'` when the customer's wallet has dropped
 * below the requested debit amount between checkout-init and webhook.
 *
 * Callers MUST match on this exact MESSAGE string. ERRCODE 'P0001' is the
 * default for plpgsql RAISE without USING ERRCODE so code matching alone
 * is not sufficient.
 *
 * If you change this string, also update the migration:
 *   supabase/migrations/<ts>_redeem_vtu_wallet_payment.sql
 */
export const INSUFFICIENT_WALLET_BALANCE_MESSAGE =
  'insufficient_wallet_balance';

/**
 * Centralised matcher for the wallet-debit "insufficient balance" RPC
 * error. The migration's contract is that the RPC raises with
 * MESSAGE='insufficient_wallet_balance' (P0001). Today supabase-js
 * surfaces that string verbatim on `error.message`, but historical
 * versions have wrapped the raw PG message with extra context
 * (e.g. `ERROR: insufficient_wallet_balance\nWHERE: PL/pgSQL ...`).
 * Match both the strict and the wrapped form so a future supabase-js
 * bump can't silently route every wallet-race into the
 * non-balance-error branch (which would turn each insufficient-balance
 * into a `VtuPersistenceError` and a webhook retry loop instead of the
 * clean insufficient-funds path — wallet-only checkout has no card
 * portion to fall back to).
 */
export function isInsufficientWalletBalanceError(
  error: { message?: string; code?: string } | null | undefined
): boolean {
  const message = error?.message;
  if (!message) return false;
  if (message === INSUFFICIENT_WALLET_BALANCE_MESSAGE) return true;
  // Defense-in-depth: substring match scoped to P0001 errors so we
  // don't accidentally match the literal phrase appearing elsewhere.
  return (
    error?.code === 'P0001' &&
    message.includes(INSUFFICIENT_WALLET_BALANCE_MESSAGE)
  );
}
