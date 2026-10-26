import { WALLET_HISTORY_PAGE_SIZE } from '@/constants/wallet-history';
import { supabase } from '@/lib/supabase';
import type { Transaction } from './wallet-query';
import { normalizeWalletTransaction } from './wallet-transaction-normalize';

export async function fetchWalletTransactions(
  merchantId: string,
  walletId: string | undefined
): Promise<Transaction[]> {
  if (!walletId) return [];
  const { data, error } = await supabase
    .from('customer_wallet_transactions')
    .select('id, type, amount, description, created_at, source_type')
    .eq('wallet_id', walletId)
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })
    .limit(WALLET_HISTORY_PAGE_SIZE);
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const transaction = normalizeWalletTransaction(row);
    return transaction ? [transaction] : [];
  });
}
