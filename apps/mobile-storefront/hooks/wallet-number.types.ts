import type {
  Transaction,
  WalletActiveSavingsGoal,
  WalletData,
} from './wallet-query';

export interface WalletNumbers {
  interestTransactions?: Transaction[];
  wallet: Pick<
    WalletData,
    | 'balance'
    | 'loyalty_points'
    | 'savings_balance'
    | 'total_balance'
    | 'earnings_available'
    | 'earnings_balance'
  >;
  goals: (Pick<
    WalletActiveSavingsGoal,
    'id' | 'current_amount' | 'target_amount' | 'status'
  > & { metadata: string })[];
}
