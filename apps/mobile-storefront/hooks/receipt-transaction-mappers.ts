interface CustomerTransactionRpcRow {
  amount: number | string | null;
  created_at: string;
  description: string | null;
  dva_account_number: string | null;
  gateway: string | null;
  status: string | null;
  transaction_type: string | null;
}

export function mapCustomerTransactionRpcRows(transactionRows: unknown) {
  const rows = (transactionRows as CustomerTransactionRpcRow[] | null) ?? [];

  return rows.map((transaction) => ({
    amount: transaction.amount,
    created_at: transaction.created_at,
    description: transaction.description,
    gateway: transaction.gateway,
    metadata: transaction.dva_account_number
      ? { dva_account_number: transaction.dva_account_number }
      : null,
    status: transaction.status,
    transaction_type: transaction.transaction_type,
  }));
}
