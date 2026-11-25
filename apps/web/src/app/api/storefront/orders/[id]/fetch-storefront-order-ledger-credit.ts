import type { SupabaseClient } from '@supabase/supabase-js';
import { sumPositiveLedgerAmounts } from '@/schemas/oxygen-checkout-order';

export type StorefrontOrderLedgerCreditResult =
  | { ok: true; walletLedgerUsed: number; savingsLedgerUsed: number }
  | { ok: false };

/**
 * Sums pre-gateway wallet and device-savings ledger redemptions for a signed-in
 * storefront order lookup so BNPL launchers use the authoritative net balance
 * even if the best-effort orders.amount_paid/wallet_amount_used sync lags.
 * Fails closed so callers never fabricate zero credit on lookup errors.
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
      .select('amount')
      .eq('source_id', orderId)
      .eq('source_type', 'order_redemption')
      .eq('type', 'redemption'),
    supabase
      .from('customer_savings_redemptions')
      .select('amount')
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
    walletLedgerUsed: sumPositiveLedgerAmounts(walletRows),
    savingsLedgerUsed: sumPositiveLedgerAmounts(savingsRows),
  };
}
