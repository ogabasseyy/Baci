import type { TransactionDiscountOptions } from './transaction-review-discount-metadata';

export function getPersistedTransactionDiscountAmount(
  options: TransactionDiscountOptions | undefined
) {
  return (
    options?.lineDiscounts?.reduce(
      (sum, allocation) =>
        sum +
        (allocation?.merchandiseDiscount ?? 0) +
        (allocation?.vatRelief ?? 0),
      0
    ) ?? null
  );
}
