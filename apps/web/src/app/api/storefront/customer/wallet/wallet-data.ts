/**
 * DB fetchers for `GET /api/storefront/customer/wallet`. Extracted from the
 * route so the handler stays focused on auth + orchestration. Pure helpers live
 * in `./wallet-data-helpers`; row/response types in `./wallet-data-types`.
 */

import {
  type CustomerSavingsEarningsRpcClient,
  fetchCustomerSavingsEarningsKobo,
} from '@baci/shared/lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { formatFundingAccount, toNumber } from './wallet-data-helpers';
import type {
  CustomerSavingsEarnings,
  CustomerWalletFetch,
  CustomerWalletTransactionRow,
  WalletFundingAccountRow,
} from './wallet-data-types';

export async function getCustomerSavingsEarnings({
  merchantId,
  supabase,
}: {
  merchantId: string;
  supabase: SupabaseClient<Database>;
}): Promise<CustomerSavingsEarnings> {
  const earningsClient =
    supabase as unknown as CustomerSavingsEarningsRpcClient;
  const creditedInterestKobo = await fetchCustomerSavingsEarningsKobo({
    client: earningsClient,
    merchantId,
  });

  return creditedInterestKobo === null
    ? { earningsAvailable: false, earningsBalance: null }
    : {
        earningsAvailable: true,
        earningsBalance: creditedInterestKobo / 100,
      };
}

export async function getSavingsBalance({
  customerId,
  merchantId,
  supabase,
}: {
  customerId: string;
  merchantId: string;
  supabase: SupabaseClient<Database>;
}) {
  const { data, error } = await supabase
    .from('customer_savings_goals')
    .select('current_amount')
    .eq('customer_id', customerId)
    .eq('merchant_id', merchantId)
    .in('status', ['active', 'paused', 'completed']);

  if (error) {
    throw error;
  }

  return (data ?? []).reduce(
    (total, row) => total + toNumber(row.current_amount),
    0
  );
}

export async function getFundingAccount({
  customerId,
  merchantId,
  supabase,
}: {
  customerId: string;
  merchantId: string;
  supabase: SupabaseClient<Database>;
}) {
  const { data, error } = await supabase
    .from('customer_wallet_payment_accounts')
    .select('account_name, account_number, bank_name, provider')
    .eq('customer_id', customerId)
    .eq('merchant_id', merchantId)
    .eq('provider', 'paystack')
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return formatFundingAccount(data as WalletFundingAccountRow | null);
}

export async function getUsdtBalance({
  customerId,
  merchantId,
  supabase,
}: {
  customerId: string;
  merchantId: string;
  supabase: SupabaseClient<Database>;
}) {
  const { data, error } = await supabase
    .from('customer_wallet_accounts')
    .select('available_balance')
    .eq('customer_id', customerId)
    .eq('merchant_id', merchantId)
    .eq('currency', 'USDT')
    .maybeSingle();
  if (error) throw error;
  return toNumber(data?.available_balance);
}

/**
 * The wallet's NGN balance plus its recent transactions — the pre-transfer
 * BASELINE the client-side funding check loop reads. See `CustomerWalletFetch`
 * for why this fails loud rather than serving an empty result on error.
 */
export async function fetchCustomerWallet({
  customerId,
  merchantId,
  supabase,
}: {
  customerId: string;
  merchantId: string;
  supabase: SupabaseClient<Database>;
}): Promise<CustomerWalletFetch> {
  const { data: wallet, error: walletError } = await supabase
    .from('customer_wallets')
    .select('id, available_balance, total_earned, total_redeemed')
    .eq('customer_id', customerId)
    .eq('merchant_id', merchantId)
    .single();

  if (walletError && walletError.code !== 'PGRST116') {
    console.error('Customer wallet lookup error:', walletError);
    return { kind: 'error' };
  }

  if (!wallet) {
    return { kind: 'no-wallet' };
  }

  const { data: transactions, error: transactionsError } = await supabase
    .from('customer_wallet_transactions')
    .select(
      'id, type, amount, balance_after, description, created_at, source_type'
    )
    .eq('wallet_id', wallet.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (transactionsError) {
    console.error('Customer wallet transactions error:', transactionsError);
    return { kind: 'error' };
  }

  return {
    availableBalance: toNumber(wallet.available_balance),
    kind: 'ok',
    totalEarned: toNumber(wallet.total_earned),
    totalRedeemed: toNumber(wallet.total_redeemed),
    transactions: (transactions ?? []) as CustomerWalletTransactionRow[],
  };
}
