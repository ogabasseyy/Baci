import type { SupabaseClient } from '@supabase/supabase-js';
import { walletSpendableBreakdownRowsSchema } from '@/schemas/wallet-spendable-breakdown';

export type WalletSpendableBreakdown = {
  spendableBalance: number;
  settledToBankTotal: number;
  pendingReconciliationTotal: number;
};

export type WalletSpendableBreakdownResult =
  | ({ ok: true } & WalletSpendableBreakdown)
  | { ok: false };

/** Spendable (GIG-bookable) vs Paystack-settled-to-bank history figures. */
export async function readWalletSpendableBreakdown(
  supabase: SupabaseClient,
  merchantId: string
): Promise<WalletSpendableBreakdownResult> {
  let result: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    result = await supabase.rpc('get_merchant_wallet_spendable_breakdown', {
      p_merchant_id: merchantId,
    });
  } catch {
    return { ok: false };
  }
  const { data, error } = result;
  if (error) return { ok: false };
  const parsed = walletSpendableBreakdownRowsSchema.safeParse(data);
  if (!parsed.success) return { ok: false };
  const row = parsed.data[0];
  // No wallet row (merchant_id is unique, so at most one): nothing to show.
  if (!row) return { ok: false };
  return {
    ok: true,
    spendableBalance: row.spendable_balance,
    settledToBankTotal: row.settled_to_bank_total,
    pendingReconciliationTotal: row.pending_reconciliation_total,
  };
}
