import type { TransactionDiscountOptions } from './transaction-review-discount-metadata';

export function resolveTransactionReviewDiscountOptions(
  persistedOptions: TransactionDiscountOptions | undefined,
  legacyOptions: TransactionDiscountOptions | undefined,
  isAdminEditedDiscount: boolean
) {
  return (
    persistedOptions ??
    legacyOptions ??
    (isAdminEditedDiscount ? { discountIncludesVat: false } : undefined)
  );
}
