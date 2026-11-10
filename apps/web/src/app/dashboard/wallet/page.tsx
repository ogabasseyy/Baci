import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readWalletSpendableBreakdown } from '@/lib/wallet/wallet-spendable-breakdown';
import {
  getTransactions,
  getWalletData,
  type PendingSettlement,
  type Transaction,
  type WalletData,
} from './actions';
import WalletClient from './wallet-client';

export const metadata: Metadata = {
  title: 'Wallet | Dashboard',
  description: 'Manage your earnings and withdrawals',
};

export default async function WalletPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('id, payout_currency')
    .eq('user_id', user.id)
    .single();

  // PGRST116 = no rows found, which is expected for new users
  if (merchantError && merchantError.code !== 'PGRST116') {
    console.error('Failed to fetch merchant:', merchantError);
    throw new Error('Failed to load merchant data');
  }

  if (!merchant) {
    redirect('/onboarding');
  }

  // Fetch data in parallel
  let walletData: {
    wallet: WalletData;
    pendingSettlements: PendingSettlement[];
  } | null;
  let transactions: Transaction[];

  try {
    [walletData, transactions] = await Promise.all([
      getWalletData(merchant.id),
      getTransactions(merchant.id),
    ]);
  } catch (error) {
    console.error('Failed to fetch wallet data:', error);
    throw new Error('Failed to load wallet data');
  }

  // Display-only: a failure here hides the cards, never the wallet page.
  const spendable = await readWalletSpendableBreakdown(supabase, merchant.id);

  return (
    <WalletClient
      wallet={walletData?.wallet || null}
      pendingSettlements={walletData?.pendingSettlements || []}
      transactions={transactions}
      merchantId={merchant.id}
      payoutCurrency={merchant.payout_currency || 'NGN'}
      spendable={spendable.ok ? spendable : null}
    />
  );
}
