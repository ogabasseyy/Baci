import {
  sumActiveSavingsLedgerCredit,
  sumNetWalletLedgerCredit,
} from '@baci/shared/lib';
import type { SupabaseClient } from '@supabase/supabase-js';

export type StorefrontOrderLedgerCreditResult =
  | { ok: true; walletLedgerUsed: number; savingsLedgerUsed: number }
  | { ok: false };

const LEDGER_CREDIT_PAYMENT_METHODS = new Set([
  'oxygen',
  'klump',
  'credit_direct',
]);

export function requiresStorefrontOrderLedgerCredit(
  paymentMethod?: string | null
): boolean {
  return LEDGER_CREDIT_PAYMENT_METHODS.has(
    (paymentMethod ?? '').trim().toLowerCase()
  );
}

/**
 * Sums pre-gateway wallet and device-savings ledger redemptions for a signed-in
 * storefront order lookup so BNPL launchers use the authoritative net balance
 * even if the best-effort orders.amount_paid/wallet_amount_used sync lags.
 * Fails closed so BNPL/Oxygen callers never fabricate zero credit on lookup errors.
 */
export async function fetchStorefrontOrderLedgerCredit(
  supabase: Pick<SupabaseClient, 'from'>,
  orderId: string
): Promise<StorefrontOrderLedgerCreditResult> {
  const [
    { data: walletRows, error: walletError },
    { data: savingsRows, error: savingsError },
  ] = await Promise.all([
    supabase
      .from('customer_wallet_transactions')
      .select('amount, status, source_type, type')
      .eq('source_id', orderId),
    supabase
      .from('customer_savings_redemptions')
      .select('amount, metadata')
      .eq('order_id', orderId),
  ]);

  if (walletError || savingsError) {
    console.error('[API/Orders] Ledger credit lookup failed:', {
      walletError,
      savingsError,
    });
    return { ok: false };
  }

  return {
    ok: true,
    walletLedgerUsed: sumNetWalletLedgerCredit(walletRows),
    savingsLedgerUsed: sumActiveSavingsLedgerCredit(savingsRows),
  };
}
