import { isAdminEditedTransactionDiscount } from './transaction-review-admin-discount-marker';
import { getDiscountedTransactionUnitPrices } from './transaction-review-discount';
import { getPersistedTransactionDiscountAmount } from './transaction-review-discount-amount';
import { parseTransactionDiscountOptions } from './transaction-review-discount-metadata';
import { resolveTransactionReviewDiscountOptions } from './transaction-review-discount-options';
import { getLegacyNegotiationDiscountOptions } from './transaction-review-legacy-discount';
import { toFiniteNumberOrNull } from './transaction-review-row-helpers';
import type { TransactionReviewOrderRow } from './transaction-review-types';
import { getQuizVoucherDiscountAmount } from './transaction-review-voucher-discount';

type TransactionReviewOrderItems = NonNullable<
  TransactionReviewOrderRow['order_items']
>;

export function getTransactionReviewDiscountPricing(
  order: TransactionReviewOrderRow,
  orderItems: TransactionReviewOrderItems
) {
  const isNetPricedMarketplaceOrder =
    order.external_source?.toLowerCase() === 'jumia';
  const isAdminEditedDiscount = isAdminEditedTransactionDiscount(
    order.ad_tracking
  );
  const persistedDiscountOptions = parseTransactionDiscountOptions(
    order.ad_tracking
  );
  const persistedDiscountAmount = getPersistedTransactionDiscountAmount(
    persistedDiscountOptions
  );
  const voucherDiscountAmount = getQuizVoucherDiscountAmount(orderItems);
  const legacyDiscountOptions = getLegacyNegotiationDiscountOptions(
    order,
    orderItems
  );
  const discountAmount =
    toFiniteNumberOrNull(order.discount_amount) ??
    (persistedDiscountAmount == null
      ? voucherDiscountAmount || null
      : persistedDiscountAmount + voucherDiscountAmount) ??
    0;
  const discountedUnitPrices = getDiscountedTransactionUnitPrices(
    orderItems,
    isNetPricedMarketplaceOrder && !isAdminEditedDiscount ? 0 : discountAmount,
    resolveTransactionReviewDiscountOptions(
      persistedDiscountOptions,
      legacyDiscountOptions,
      isAdminEditedDiscount
    )
  );

  return { discountAmount, discountedUnitPrices };
}
