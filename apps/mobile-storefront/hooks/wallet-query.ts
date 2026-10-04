export interface WalletData {
  active_savings_goal?: WalletActiveSavingsGoal | null;
  balance: number;
  earnings_available?: boolean;
  earnings_balance?: number | null;
  funding_account?: WalletFundingAccount | null;
  loyalty_points: number;
  requires_funding_account_consent?: boolean;
  savings_balance?: number;
  total_balance?: number;
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
  source_mode: 'manual' | 'auto_debit';
  status: 'active' | 'paused' | 'completed';
  target_amount: number;
  title: string;
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
}

function walletDataKey(
  owner: WalletDataKeyInput
): readonly ['wallet', 'data', 'v3', string, string] {
  if (!owner.merchantId) {
    throw new Error('wallet data query keys require a merchantId');
  }
  if (!owner.ownerId) {
    throw new Error('wallet data query keys require an ownerId');
  }

  return Object.freeze([
    ...WALLET_QUERY_ROOT,
    'data',
    'v3',
    owner.ownerId,
    owner.merchantId,
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
