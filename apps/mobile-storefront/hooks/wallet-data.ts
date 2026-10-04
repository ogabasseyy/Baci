import { z } from 'zod';
import { REDEEMABLE_SAVINGS_STATUSES } from '@/lib/checkout-savings';
import { supabase } from '@/lib/supabase';
import { CustomerRowSchema, TransactionRowSchema } from '@/lib/validation';
import { trackEvent } from '@/services/analytics';
import type {
  Transaction,
  WalletActiveSavingsGoal,
  WalletQueryData,
} from './wallet-query';
import {
  getActiveSavingsGoal,
  getOwnedSavingsGoals,
  toActiveSavingsGoal,
} from './wallet-savings-data';
import {
  fetchWalletSavingsInterest,
  toWalletSavingsInterestEarnings,
} from './wallet-savings-interest';
import { projectWalletSavingsInterest } from './wallet-savings-interest-projection';

const WalletFundingAccountSchema = z.object({
  account_name: z.string().min(1),
  account_number: z.string().regex(/^\d{10,20}$/),
  bank_name: z.string().min(1),
  provider: z.literal('paystack'),
});

const WalletTransactionDataSchema = TransactionRowSchema.omit({
  amount: true,
  id: true,
}).extend({
  amount: z.union([z.number(), z.string()]),
  id: z.string(),
});

function coerceDatabaseNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return null;
    }

    const numericValue = Number(trimmedValue);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  return null;
}

function normalizeWalletTransaction(row: unknown): Transaction | null {
  const validation = WalletTransactionDataSchema.safeParse(row);
  if (!validation.success) {
    return null;
  }

  const amount = coerceDatabaseNumber(validation.data.amount);
  if (amount === null) {
    return null;
  }

  return {
    ...validation.data,
    amount,
    description: validation.data.description ?? '',
  };
}

function getJoinedSavingsGoalProduct({
  goalId,
  rows,
}: {
  goalId: string;
  rows: unknown[];
}) {
  const sourceRow = rows.find(
    (row) =>
      row && typeof row === 'object' && (row as { id?: unknown }).id === goalId
  );
  if (!sourceRow || typeof sourceRow !== 'object') {
    return undefined;
  }

  return (sourceRow as { products?: unknown }).products;
}

function getEmptyWalletData(loyaltyPoints: unknown = 0): WalletQueryData {
  const safeLoyaltyPoints = coerceDatabaseNumber(loyaltyPoints) ?? 0;
  return {
    wallet: {
      active_savings_goal: null,
      balance: 0,
      earnings_available: false,
      earnings_balance: 0,
      funding_account: null,
      loyalty_points: safeLoyaltyPoints,
      requires_funding_account_consent: true,
      savings_balance: 0,
      savings_goals: [],
      total_balance: 0,
    },
    transactions: [],
  };
}

export async function fetchWalletData(
  customerId: string | null,
  merchantId: string,
  userId: string | null
): Promise<WalletQueryData> {
  if (!customerId && !userId) {
    return getEmptyWalletData();
  }

  let customerQuery = supabase
    .from('customers')
    .select('id, loyalty_points')
    .eq('merchant_id', merchantId);

  if (customerId) {
    customerQuery = customerQuery.eq('id', customerId);
  } else if (userId) {
    customerQuery = customerQuery.eq('user_id', userId);
  }

  const customerResult = await customerQuery.limit(2);

  if (customerResult.error) {
    throw customerResult.error;
  }

  const customerRows = Array.isArray(customerResult.data)
    ? customerResult.data
    : [];

  if (customerRows.length === 0) {
    return getEmptyWalletData();
  }

  if (customerRows.length > 1) {
    console.warn('Expected one customer wallet owner, received multiple rows', {
      customerId,
      merchantId,
      userId,
    });
    trackEvent('multiple_customer_wallet_owner', {
      customerId,
      merchantId,
      numberOfRows: customerRows.length,
      severity: 'data_integrity',
      userId,
    });
    return getEmptyWalletData();
  }

  const customerRow = customerRows[0];
  const resolvedCustomerId =
    customerId ?? (typeof customerRow.id === 'string' ? customerRow.id : '');

  if (!resolvedCustomerId) {
    const customerValidation = CustomerRowSchema.pick({
      loyalty_points: true,
    }).safeParse(customerRow);
    const safeLoyaltyPoints =
      customerValidation.success &&
      customerValidation.data.loyalty_points != null
        ? (coerceDatabaseNumber(customerValidation.data.loyalty_points) ?? 0)
        : (coerceDatabaseNumber(customerRow.loyalty_points) ?? 0);

    return {
      wallet: {
        active_savings_goal: null,
        balance: 0,
        earnings_available: false,
        earnings_balance: 0,
        funding_account: null,
        loyalty_points: safeLoyaltyPoints,
        requires_funding_account_consent: true,
        savings_balance: 0,
        savings_goals: [],
        total_balance: 0,
      },
      transactions: [],
    };
  }

  const walletResult = await supabase
    .from('customer_wallets')
    .select('id, available_balance')
    .eq('merchant_id', merchantId)
    .eq('customer_id', resolvedCustomerId)
    .maybeSingle();

  if (walletResult.error) {
    throw walletResult.error;
  }

  const [fundingAccountResult, savingsGoalsResult, savingsInterest] =
    await Promise.all([
      supabase
        .from('customer_wallet_payment_accounts')
        .select('account_name, account_number, bank_name, provider')
        .eq('merchant_id', merchantId)
        .eq('customer_id', resolvedCustomerId)
        .eq('provider', 'paystack')
        .eq('status', 'active')
        .maybeSingle(),
      supabase
        .from('customer_savings_goals')
        .select(
          // Variant projection lists only columns that exist on
          // product_variants (see generated Row type): is_active, status,
          // deleted_at, and archived_at were never added, and PostgREST
          // rejects the entire goals query when any selected column is
          // unknown — failing wallet load for every customer.
          'id, product_id, variant_id, title, product_snapshot, target_amount, current_amount, contribution_amount, contribution_frequency, source_mode, status, maturity_date, products(id, name, images, condition, price, variants:product_variants!product_variants_product_id_fkey(id, condition, sku, price_override, primary_image, images, attributes, is_inventory_anchor))'
        )
        .eq('merchant_id', merchantId)
        .eq('customer_id', resolvedCustomerId)
        .in('status', [...REDEEMABLE_SAVINGS_STATUSES])
        .order('created_at', { ascending: false }),
      // Best-effort and never throws: on any failure it resolves to an
      // explicit unavailable marker, so the wallet still loads.
      fetchWalletSavingsInterest(merchantId),
    ]);

  if (fundingAccountResult.error) {
    throw fundingAccountResult.error;
  }
  if (savingsGoalsResult.error) {
    throw savingsGoalsResult.error;
  }

  const savingsGoalRows = Array.isArray(savingsGoalsResult.data)
    ? savingsGoalsResult.data
    : [];
  // Confirmed per-goal interest credits adjust each goal's progress and
  // the savings/total balances before any selection or reduction, so plan
  // progress agrees with the Earnings cell.
  const {
    goals: projectedSavingsGoalRows,
    savingsBalance: safeSavingsBalance,
  } = projectWalletSavingsInterest({
    goals: savingsGoalRows,
    goalInterestKobo: savingsInterest.goalInterestKobo,
  });
  const activeSavingsGoalRow = getActiveSavingsGoal(projectedSavingsGoalRows);
  let activeSavingsGoal: WalletActiveSavingsGoal | null = null;

  if (activeSavingsGoalRow) {
    activeSavingsGoal = toActiveSavingsGoal({
      goal: activeSavingsGoalRow,
      product: activeSavingsGoalRow.product_id
        ? getJoinedSavingsGoalProduct({
            goalId: activeSavingsGoalRow.id,
            rows: projectedSavingsGoalRows,
          })
        : undefined,
    });
  }

  // All owned redeemable goals (same merchant/customer-scoped rows): lets
  // the wallet open the exact goal a push notification names instead of
  // always the first active row. Rows that fail display mapping are
  // dropped, matching the active-goal behavior.
  const savingsGoals = getOwnedSavingsGoals(projectedSavingsGoalRows).flatMap(
    (row) => {
      const mapped = toActiveSavingsGoal({
        goal: row,
        product: row.product_id
          ? getJoinedSavingsGoalProduct({
              goalId: row.id,
              rows: projectedSavingsGoalRows,
            })
          : undefined,
      });
      return mapped ? [mapped] : [];
    }
  );

  const fundingAccountValidation =
    WalletFundingAccountSchema.nullable().safeParse(fundingAccountResult.data);
  const fundingAccountData = fundingAccountValidation.success
    ? fundingAccountValidation.data
    : null;

  let transactionRows: Transaction[] = [];
  if (walletResult.data?.id) {
    const txResult = await supabase
      .from('customer_wallet_transactions')
      .select('id, type, amount, description, created_at, source_type')
      .eq('wallet_id', walletResult.data.id)
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (txResult.error) {
      throw txResult.error;
    }

    if (txResult.data) {
      transactionRows = txResult.data.reduce<Transaction[]>((rows, row) => {
        const transaction = normalizeWalletTransaction(row);
        if (transaction) {
          rows.push(transaction);
        }
        return rows;
      }, []);
    }
  }

  const customerValidation = CustomerRowSchema.pick({
    loyalty_points: true,
  }).safeParse(customerRow);

  const safeBalance =
    coerceDatabaseNumber(walletResult.data?.available_balance) ?? 0;

  const safeLoyaltyPoints =
    customerValidation.success && customerValidation.data.loyalty_points != null
      ? (coerceDatabaseNumber(customerValidation.data.loyalty_points) ?? 0)
      : (coerceDatabaseNumber(customerRow.loyalty_points) ?? 0);

  return {
    wallet: {
      active_savings_goal: activeSavingsGoal,
      balance: safeBalance,
      ...toWalletSavingsInterestEarnings(savingsInterest),
      funding_account: fundingAccountData,
      loyalty_points: safeLoyaltyPoints,
      requires_funding_account_consent: fundingAccountData === null,
      savings_balance: safeSavingsBalance,
      savings_goals: savingsGoals,
      total_balance: safeBalance + safeSavingsBalance,
    },
    transactions: transactionRows,
  };
}
