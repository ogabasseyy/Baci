export interface WalletData {
  active_savings_goal?: WalletActiveSavingsGoal | null;
  balance: number;
  earnings_available?: boolean;
  earnings_balance?: number | null;
  funding_account?: WalletFundingAccount | null;
  loyalty_points: number;
  requires_funding_account_consent?: boolean;
  savings_balance?: number;
  savings_goals?: WalletActiveSavingsGoal[];
  total_balance?: number;
}

export interface WalletSavingsVariantResolutionOption {
  id: string;
  label: string;
}

export interface WalletActiveSavingsGoal {
  contribution_amount: number;
  contribution_frequency: 'daily' | 'weekly' | 'monthly';
  current_amount: number;
  id: string;
  maturity_date: string;
  product_condition?: string | null;
  product_image?: string | null;
  product_variant_label?: string | null;
  selection_unresolved?: boolean;
  source_mode: 'manual' | 'auto_debit';
  status: 'active' | 'paused' | 'completed';
  target_amount: number;
  title: string;
  variant_resolution_options?: WalletSavingsVariantResolutionOption[];
}

export type WalletFundingProvider = 'paystack' | (string & {});

export interface WalletFundingAccount {
  account_name: string;
  account_number: string;
  bank_name: string;
  provider: WalletFundingProvider;
}

export interface Transaction {
  id: string;
  type:
    | 'credit'
    | 'debit'
    | 'cashback'
    | 'redemption'
    | 'bonus'
    | 'adjustment'
    | 'expiry'
    | 'refund';
  amount: number;
  description: string;
  created_at: string;
  /** `customer_wallet_transactions.source_type` — `wallet_topup` for funding. */
  source_type?: string | null;
}

export interface WalletQueryData {
  wallet: WalletData;
  transactions: Transaction[];
}

const WALLET_QUERY_ROOT = Object.freeze(['wallet'] as const);

interface WalletDataKeyInput {
  merchantId: string;
  ownerId: string;
  // Identity pin: the auth user behind the owner. Producers that know
  // the user pass it so a user rotation (same customer row, new user
  // id) cannot reuse the previous user's cached wallet — including a
  // stale primary funding snapshot. Omitted by prefix invalidators,
  // which still match every user variant of the key.
  userId?: string | null;
}

function walletDataKey(
  owner: WalletDataKeyInput
): readonly ['wallet', 'data', 'v4', string, string, ...string[]] {
  if (!owner.merchantId) {
    throw new Error('wallet data query keys require a merchantId');
  }
  if (!owner.ownerId) {
    throw new Error('wallet data query keys require an ownerId');
  }

  return Object.freeze([
    ...WALLET_QUERY_ROOT,
    'data',
    'v4',
    owner.ownerId,
    owner.merchantId,
    ...(owner.userId ? [owner.userId] : []),
  ] as const);
}

export const walletKeys = {
  all: WALLET_QUERY_ROOT,
  data: walletDataKey,
  transactions: (customerId: string) => {
    if (!customerId) {
      throw new Error('wallet transaction query keys require a customerId');
    }
    return Object.freeze([
      ...WALLET_QUERY_ROOT,
      'transactions',
      customerId,
    ] as const);
  },
};

export type WalletQueryKey = ReturnType<typeof walletKeys.data>;
