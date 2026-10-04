interface CustomerTransactionRpcRow {
  amount: number | string | null;
  created_at: string;
  description: string | null;
  dva_account_number: string | null;
  gateway: string | null;
  order_id: string;
  payment_method: string | null;
  status: string | null;
  transaction_type: string | null;
}

export function mapCustomerTransactionRpcRows(transactionRows: unknown) {
  const rows = (transactionRows as CustomerTransactionRpcRow[] | null) ?? [];

  // The recorded method rides as metadata.payment_method exactly like the
  // web transform and generator input, so the preview's
  // method → description → 'Payment' fallback agrees with the email.
  // Rows predating the projection carry a null method and map as before.
  return rows.map((transaction) => ({
    amount: transaction.amount,
    created_at: transaction.created_at,
    description: transaction.description,
    gateway: transaction.gateway,
    metadata:
      transaction.dva_account_number || transaction.payment_method
        ? {
            ...(transaction.dva_account_number
              ? { dva_account_number: transaction.dva_account_number }
              : null),
            ...(transaction.payment_method
              ? { payment_method: transaction.payment_method }
              : null),
          }
        : null,
    order_id: transaction.order_id,
    status: transaction.status,
    transaction_type: transaction.transaction_type,
  }));
}
