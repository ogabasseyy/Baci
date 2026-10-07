import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import z from 'zod';
import { PiggyvestApiError, type PiggyvestClientConfig } from './client';
import { InterestLedgerError, sumPaidInterestKobo } from './interest-ledger';
import { retrievePiggyvestFundingAccounts } from './wallet-funding';
import { retrievePiggyvestWallet } from './wallets';

/**
 * Plan-wallet snapshot reads: Baci customer/merchant -> provider wallet.
 *
 * - Balances always come from live provider reads; the mapping row stores
 *   identity only, never money.
 * - Paid interest comes only from the verified payout ledger
 *   (interest-payout.success processing). Pending accrual stays zero: no
 *   partial accrual sums are ever presented as spendable or pending money.
 * - Provisioning lives in plan-wallet-provisioning.ts.
 */

export type PlanWalletSnapshotStatus =
  | 'none'
  | 'provisioning'
  | 'ready'
  | 'restricted';

export interface PlanWalletSnapshot {
  status: PlanWalletSnapshotStatus;
  walletId: string | null;
  accountNumber: string | null;
  accountName: string | null;
  bankName: string | null;
  balanceKobo: number;
  paidInterestKobo: number;
  pendingAccrualKobo: number;
}

import { PlanWalletError } from './plan-wallet-mapping';

export { PlanWalletError };

const planWalletRowSchema = z.object({
  piggyvest_customer_id: z.string().min(1),
  wallet_id: z.string().min(1),
  subaccount_name: z.string().min(1),
  status: z.enum(['provisioning', 'ready', 'restricted']),
});

export type PlanWalletRow = z.infer<typeof planWalletRowSchema>;

export interface PlanWalletScope {
  customerId: string;
  merchantId: string;
}

const scopeSchema = z.object({
  customerId: z.string().min(1),
  merchantId: z.string().min(1),
});

export function parsePlanWalletScope(scope: PlanWalletScope): PlanWalletScope {
  return scopeSchema.parse(scope);
}

export function noneSnapshot(): PlanWalletSnapshot {
  return {
    status: 'none',
    walletId: null,
    accountNumber: null,
    accountName: null,
    bankName: null,
    balanceKobo: 0,
    paidInterestKobo: 0,
    pendingAccrualKobo: 0,
  };
}

export async function readMappingRow(
  supabase: SupabaseClient,
  scope: PlanWalletScope
): Promise<PlanWalletRow | null> {
  const { data, error } = await supabase
    .from('piggyvest_plan_wallets')
    .select('piggyvest_customer_id, wallet_id, subaccount_name, status')
    .eq('customer_id', scope.customerId)
    .eq('merchant_id', scope.merchantId)
    .maybeSingle();
  if (error) {
    throw new PlanWalletError(
      'PLAN_WALLET_STORAGE_ERROR',
      'Plan wallet lookup failed'
    );
  }
  if (!data) return null;
  const parsed = planWalletRowSchema.safeParse(data);
  if (!parsed.success) {
    throw new PlanWalletError(
      'PLAN_WALLET_STORAGE_ERROR',
      'Plan wallet record is invalid'
    );
  }
  return parsed.data;
}

export async function snapshotForRow(
  supabase: SupabaseClient,
  config: PiggyvestClientConfig,
  row: PlanWalletRow
): Promise<PlanWalletSnapshot> {
  if (row.status === 'restricted') {
    return { ...noneSnapshot(), status: 'restricted', walletId: row.wallet_id };
  }
  let wallet: { status: string; balance: number };
  try {
    wallet = await retrievePiggyvestWallet(config, row.wallet_id);
  } catch (error) {
    throw new PlanWalletError(
      'PLAN_WALLET_PROVIDER_ERROR',
      error instanceof PiggyvestApiError ? error.message : 'Wallet read failed'
    );
  }
  if (wallet.status !== 'active') {
    return {
      ...noneSnapshot(),
      status: 'provisioning',
      walletId: row.wallet_id,
    };
  }
  let accounts: Awaited<ReturnType<typeof retrievePiggyvestFundingAccounts>> =
    [];
  try {
    accounts = await retrievePiggyvestFundingAccounts(config, row.wallet_id);
  } catch (error) {
    throw new PlanWalletError(
      'PLAN_WALLET_PROVIDER_ERROR',
      error instanceof PiggyvestApiError
        ? error.message
        : 'Funding account read failed'
    );
  }
  const first = accounts[0];
  const paidInterestKobo = await readPaidInterest(supabase, row.wallet_id);
  return {
    status: 'ready',
    walletId: row.wallet_id,
    accountNumber: first?.account_number ?? null,
    accountName: first?.account_name ?? null,
    bankName: first?.bank_name ?? null,
    balanceKobo: wallet.balance,
    paidInterestKobo,
    pendingAccrualKobo: 0,
  };
}

async function readPaidInterest(
  supabase: SupabaseClient,
  walletId: string
): Promise<number> {
  try {
    return await sumPaidInterestKobo(supabase, walletId);
  } catch (error) {
    throw new PlanWalletError(
      'PLAN_WALLET_STORAGE_ERROR',
      error instanceof InterestLedgerError
        ? error.message
        : 'Paid interest read failed'
    );
  }
}

export async function getPlanWalletSnapshot(
  supabase: SupabaseClient,
  config: PiggyvestClientConfig | null,
  scope: PlanWalletScope
): Promise<PlanWalletSnapshot> {
  const parsedScope = parsePlanWalletScope(scope);
  if (!config) {
    throw new PlanWalletError(
      'PLAN_WALLET_NOT_CONFIGURED',
      'PiggyVest is not configured'
    );
  }
  const row = await readMappingRow(supabase, parsedScope);
  if (!row) return noneSnapshot();
  return snapshotForRow(supabase, config, row);
}
