export type Transaction = {
  id: string;
  type: 'credit' | 'debit' | 'withdrawal' | 'payout' | 'refund' | 'adjustment';
  amount: number;
  balanceAfter: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  description: string;
  createdAt: string;
};

interface WalletTransactionRow {
  id: string;
  type: string;
  amount: number | string;
  balance_after: number | string;
  status: string;
  description: string | null;
  created_at: string | null;
}

const TRANSACTION_TYPES = [
  'credit',
  'debit',
  'withdrawal',
  'payout',
  'refund',
  'adjustment',
] as const;
const TRANSACTION_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const;

export function mapWalletTransaction(row: WalletTransactionRow): Transaction {
  return {
    id: row.id,
    type: TRANSACTION_TYPES.find((type) => type === row.type) ?? 'credit',
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    status:
      TRANSACTION_STATUSES.find((status) => status === row.status) ?? 'pending',
    description: row.description ?? '',
    createdAt: row.created_at ?? '',
  };
}
