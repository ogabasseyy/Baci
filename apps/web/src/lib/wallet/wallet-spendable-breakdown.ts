import type { SupabaseClient } from '@supabase/supabase-js';
import { walletSpendableBreakdownRowsSchema } from '@/schemas/wallet-spendable-breakdown';

export type WalletSpendableBreakdown = {
  spendableBalance: number;
  settledToBankTotal: number;
};

export type WalletSpendableBreakdownResult =
  | ({ ok: true } & WalletSpendableBreakdown)
  | { ok: false };

/** Spendable (GIG-bookable) vs Paystack-settled-to-bank history figures. */
export async function readWalletSpendableBreakdown(
  supabase: SupabaseClient,
  merchantId: string
): Promise<WalletSpendableBreakdownResult> {
  const { data, error } = await supabase.rpc(
    'get_merchant_wallet_spendable_breakdown',
    { p_merchant_id: merchantId }
  );
  if (error) return { ok: false };
  const parsed = walletSpendableBreakdownRowsSchema.safeParse(data);
  if (!parsed.success) return { ok: false };
  const row = parsed.data[0];
  return {
    ok: true,
    spendableBalance: row?.spendable_balance ?? 0,
    settledToBankTotal: row?.settled_to_bank_total ?? 0,
  };
}
