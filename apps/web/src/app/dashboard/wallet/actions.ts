'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { walletActionConfig } from './wallet-action-config';
import { mapWalletTransaction } from './wallet-transaction';

export type { Transaction } from './wallet-transaction';

/** Verify the authenticated user owns the given merchant. */
async function verifyMerchantOwnership(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  merchantId: string
): Promise<
  { success: true; userId: string } | { success: false; error: string }
> {
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id')
    .eq('id', merchantId)
    .eq('user_id', userId)
    .single();

  if (!merchant) {
    return { success: false, error: 'Merchant not found or access denied' };
  }

  return { success: true, userId };
}

export type WalletData = {
  id: string;
  availableBalance: number;
  pendingBalance: number;
  upcomingBalance: number;
  upcomingCount: number;
  totalEarned: number;
  totalWithdrawn: number;
  autoPayoutEnabled: boolean;
  autoPayoutDay: string;
  minPayoutAmount: number;
  lastPayoutAt: string | null;
  lastPayoutAmount: number | null;
  canWithdraw: boolean;
  nextSettlementDate: string | null;
  nextSettlementAmount: number | null;
};

export type PendingSettlement = {
  id: string;
  amount: number;
  gateway: string;
  sourceType: string;
  expectedDate: string;
  description: string;
};

export async function getWalletData(merchantId: string) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  // Verify ownership
  const ownershipCheck = await verifyMerchantOwnership(
    supabase,
    user.id,
    merchantId
  );
  if (!ownershipCheck.success) {
    return null;
  }

  // Fetch pending settlements and wallet summary concurrently
  const [
    { data: pendingSettlements },
    { data: walletSummary, error: summaryError },
  ] = await Promise.all([
    supabase
      .from('merchant_settlements')
      .select(
        'id, net_amount, gateway, source_type, expected_settlement_date, description'
      )
      .eq('merchant_id', merchantId)
      .eq('status', 'pending')
      .order('expected_settlement_date', { ascending: true })
      .limit(10),
    supabase.rpc('get_wallet_summary', { p_merchant_id: merchantId }),
  ]);

  if (summaryError || !walletSummary?.[0]) {
    // Fallback if RPC fails or returns empty
    const { data: wallet } = await supabase
      .from('merchant_wallets')
      .select(
        'id, available_balance, pending_balance, upcoming_balance, upcoming_count, total_earned, total_withdrawn, auto_payout_enabled, auto_payout_day, min_payout_amount, last_payout_at, last_payout_amount'
      )
      .eq('merchant_id', merchantId)
      .single();

    if (!wallet) return null;

    return {
      wallet: {
        id: wallet.id,
        availableBalance: Number(wallet.available_balance),
        pendingBalance: Number(wallet.pending_balance),
        upcomingBalance: Number(wallet.upcoming_balance || 0),
        upcomingCount: wallet.upcoming_count || 0,
        totalEarned: Number(wallet.total_earned),
        totalWithdrawn: Number(wallet.total_withdrawn),
        autoPayoutEnabled: wallet.auto_payout_enabled,
        autoPayoutDay: wallet.auto_payout_day,
        minPayoutAmount: Number(wallet.min_payout_amount),
        lastPayoutAt: wallet.last_payout_at,
        lastPayoutAmount: wallet.last_payout_amount
          ? Number(wallet.last_payout_amount)
          : null,
        canWithdraw: false, // Withdrawals are disabled
        nextSettlementDate: null,
        nextSettlementAmount: null,
      } as WalletData,
      pendingSettlements: [] as PendingSettlement[],
    };
  }

  const summary = walletSummary[0];

  // Get additional settings not in summary
  const { data: walletSettings } = await supabase
    .from('merchant_wallets')
    .select(
      'auto_payout_enabled, auto_payout_day, min_payout_amount, last_payout_at, last_payout_amount'
    )
    .eq('id', summary.wallet_id)
    .single();

  return {
    wallet: {
      id: summary.wallet_id,
      availableBalance: Number(summary.available_balance),
      pendingBalance: Number(summary.pending_balance),
      upcomingBalance: Number(summary.upcoming_balance),
      upcomingCount: summary.upcoming_count,
      totalEarned: Number(summary.total_earned),
      totalWithdrawn: Number(summary.total_withdrawn),
      autoPayoutEnabled: walletSettings?.auto_payout_enabled ?? true,
      autoPayoutDay: walletSettings?.auto_payout_day ?? 'monday',
      minPayoutAmount: Number(walletSettings?.min_payout_amount || 1000),
      lastPayoutAt: walletSettings?.last_payout_at,
      lastPayoutAmount: walletSettings?.last_payout_amount
        ? Number(walletSettings.last_payout_amount)
        : null,
      canWithdraw: false, // Withdrawals are disabled
      nextSettlementDate: summary.next_settlement_date,
      nextSettlementAmount: summary.next_settlement_amount
        ? Number(summary.next_settlement_amount)
        : null,
    } as WalletData,
    pendingSettlements: (pendingSettlements || []).map((s) => ({
      id: s.id,
      amount: Number(s.net_amount),
      gateway: s.gateway,
      sourceType: s.source_type,
      expectedDate: s.expected_settlement_date,
      description: s.description,
    })) as PendingSettlement[],
  };
}

export async function getTransactions(merchantId: string, limit = 10) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return [];
  }

  // Clamp limit to prevent excessive queries
  const safeLimit = Math.min(
    Math.max(1, limit),
    walletActionConfig.maxTransactionLimit
  );

  // Verify ownership
  const ownershipCheck = await verifyMerchantOwnership(
    supabase,
    user.id,
    merchantId
  );
  if (!ownershipCheck.success) {
    return [];
  }

  const { data: transactions, error: transactionsError } = await supabase
    .from('wallet_transactions')
    .select('id, type, amount, balance_after, status, description, created_at')
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (transactionsError) {
    console.error('Failed to fetch wallet transactions:', transactionsError);
    return [];
  }

  return (transactions || []).map(mapWalletTransaction);
}

export async function updateWalletSettings(
  merchantId: string,
  settings: {
    autoPayoutEnabled?: boolean;
    autoPayoutDay?: string;
    minPayoutAmount?: number;
  }
) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Unauthorized' };
  }

  // Verify ownership
  const ownershipCheck = await verifyMerchantOwnership(
    supabase,
    user.id,
    merchantId
  );
  if (!ownershipCheck.success) {
    return { success: false, error: ownershipCheck.error };
  }

  const updates: Record<string, unknown> = {};

  if (typeof settings.autoPayoutEnabled === 'boolean') {
    updates.auto_payout_enabled = settings.autoPayoutEnabled;
  }

  // Validate payout day
  if (settings.autoPayoutDay) {
    const day = settings.autoPayoutDay.toLowerCase();
    if (
      !walletActionConfig.validPayoutDays.includes(
        day as (typeof walletActionConfig.validPayoutDays)[number]
      )
    ) {
      return { success: false, error: 'Invalid payout day' };
    }
    updates.auto_payout_day = day;
  }

  // Validate minimum payout amount
  if (settings.minPayoutAmount !== undefined) {
    if (!Number.isFinite(settings.minPayoutAmount)) {
      return { success: false, error: 'Invalid payout amount' };
    }
    if (settings.minPayoutAmount < walletActionConfig.minimumWithdrawalAmount) {
      return {
        success: false,
        error: `Minimum payout amount must be at least ₦${walletActionConfig.minimumWithdrawalAmount.toLocaleString()}`,
      };
    }
    updates.min_payout_amount = settings.minPayoutAmount;
  }

  if (Object.keys(updates).length === 0) {
    return { success: true }; // Nothing to update
  }

  const { error } = await supabase
    .from('merchant_wallets')
    .update(updates)
    .eq('merchant_id', merchantId);

  if (error) {
    console.error('Failed to update wallet settings:', error);
    return { success: false, error: 'Failed to update settings' };
  }

  revalidatePath('/dashboard/wallet');
  return { success: true };
}
