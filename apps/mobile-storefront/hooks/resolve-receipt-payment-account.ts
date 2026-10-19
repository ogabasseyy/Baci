import {
  getPaystackDvaAccountNumberFromTransactions,
  type OrderPaymentAccountLike,
  selectPreferredOrderPaymentAccount,
} from '@baci/shared';

interface ReceiptTransaction {
  created_at?: string | null;
  gateway?: string | null;
  metadata?: unknown;
  status?: string | null;
  transaction_type?: string | null;
}

export function resolveReceiptPaymentAccount<T extends OrderPaymentAccountLike>(
  virtualAccounts: readonly T[] | null | undefined,
  transactions: readonly ReceiptTransaction[] | null | undefined,
  paymentStatus: string | null | undefined,
  now = new Date()
) {
  const isPaid = paymentStatus?.trim().toLowerCase() === 'paid';

  return selectPreferredOrderPaymentAccount(virtualAccounts, now, {
    allowExpiredPaystackAccount: isPaid,
    preferredPaystackAccountNumber: isPaid
      ? getPaystackDvaAccountNumberFromTransactions(transactions)
      : null,
    allowDeviceClockSkew: true,
  });
}
