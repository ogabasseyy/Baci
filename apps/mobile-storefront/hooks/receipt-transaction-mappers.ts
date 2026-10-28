import { isDecimalMoney } from '@baci/shared/receipt';

interface CustomerTransactionRpcRow {
  amount: number | string | null;
  created_at: string | null;
  description: string | null;
  dva_account_number: string | null;
  gateway: string | null;
  order_id: string;
  payment_method: string | null;
  status: string | null;
  transaction_type: string | null;
}

export function mapCustomerTransactionRpcRows(transactionRows: unknown) {
  // A corrupt payload (or row) maps to nothing: the detail loader fails
  // the amount closed downstream instead of throwing on .map/.amount.
  // A missing order_id is corrupt too: the list groups by it, so an
  // undefined key would merge unrelated rows into a phantom bucket.
  if (!Array.isArray(transactionRows)) return [];
  const rows = (
    transactionRows as Array<CustomerTransactionRpcRow | null>
  ).filter(
    (row): row is CustomerTransactionRpcRow =>
      row != null &&
      typeof row === 'object' &&
      !Array.isArray(row) &&
      typeof row.order_id === 'string' &&
      row.order_id !== ''
  );

  // The recorded method rides as metadata.payment_method exactly like the
  // web transform and generator input, so the preview's
  // method → description → 'Payment' fallback agrees with the email.
  // Rows predating the projection carry a null method and map as before.
  // PostgREST numerics arrive as decimal strings while the detail schema
  // gates numbers: coerce strictly (blank/bool/garbage → NaN fails the
  // detail closed; the list settled-check accepts numbers identically).
  return rows.map((transaction) => ({
    amount:
      transaction.amount == null || typeof transaction.amount === 'number'
        ? transaction.amount
        : isDecimalMoney(transaction.amount)
          ? Number(transaction.amount)
          : Number.NaN,
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
