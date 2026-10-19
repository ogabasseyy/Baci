import { getValidatedExplicitLineDiscounts } from './transaction-review-discount-allocation-validation';
import {
  type DiscountableTransactionItem,
  resolveTransactionDiscountAllocation,
} from './transaction-review-discount-allocations';
import { applyFallbackTransactionDiscount } from './transaction-review-discount-fallback';
import type { TransactionDiscountOptions } from './transaction-review-discount-metadata';
import { getPersistedLineKeyOccurrenceOrdinals } from './transaction-review-persisted-line-key-occurrences';
import { toFiniteNumberOrNull } from './transaction-review-row-helpers';
import {
  getQuizVoucherDiscountAmount,
  isQuizVoucherLine,
} from './transaction-review-voucher-discount';

export type { TransactionDiscountLineAllocation } from '@baci/shared/contracts';
export type { DiscountableTransactionItem } from './transaction-review-discount-allocations';

/** Returns effective unit prices after applying an order-level discount. */
export function getDiscountedTransactionUnitPrices(
  items: DiscountableTransactionItem[],
  discountAmount: number | string | null | undefined,
  options?: TransactionDiscountOptions
) {
  const unitPrices = items.map((item) => toFiniteNumberOrNull(item.price) ?? 0);
  const lineTotals = items.map((item, index) => {
    const quantity = Math.max(0, toFiniteNumberOrNull(item.quantity) ?? 1);
    const merchandiseTotal = Math.max(0, unitPrices[index] ?? 0) * quantity;
    const assuranceFee = Math.max(
      0,
      toFiniteNumberOrNull(item.assurance_fee) ?? 0
    );
    return {
      merchandiseTotal,
      quantity,
      total: merchandiseTotal + assuranceFee,
    };
  });
  const discountBasis = lineTotals.reduce((sum, line) => sum + line.total, 0);
  const normalizedDiscount = Math.max(
    0,
    toFiniteNumberOrNull(discountAmount) ?? 0
  );

  if (discountBasis <= 0 || normalizedDiscount <= 0) {
    return unitPrices;
  }

  const voucherLineIndexes = new Set(
    items.flatMap((item, index) => (isQuizVoucherLine(item) ? [index] : []))
  );
  const voucherDiscountBasis = getQuizVoucherDiscountAmount(items);

  const explicitLineDiscounts = options?.lineDiscounts;
  if (explicitLineDiscounts) {
    const occurrenceOrdinals = getPersistedLineKeyOccurrenceOrdinals(items);
    let allocationsByLineId = getValidatedExplicitLineDiscounts(
      items,
      lineTotals,
      normalizedDiscount,
      explicitLineDiscounts,
      occurrenceOrdinals
    );
    let voucherDiscount = 0;
    let fallbackMerchandiseDiscount = 0;
    const explicitMerchandiseDiscount = explicitLineDiscounts.reduce(
      (sum, allocation) =>
        sum +
        Math.max(0, toFiniteNumberOrNull(allocation?.merchandiseDiscount) ?? 0),
      0
    );
    const explicitVatRelief = explicitLineDiscounts.reduce(
      (sum, allocation) =>
        sum + Math.max(0, toFiniteNumberOrNull(allocation?.vatRelief) ?? 0),
      0
    );
    const explicitDiscount = explicitMerchandiseDiscount + explicitVatRelief;
    const hasUsableExplicitDiscount =
      explicitDiscount > 0 && explicitDiscount <= normalizedDiscount + 0.01;
    const hasAuthoritativeExplicitDiscount =
      hasUsableExplicitDiscount &&
      Math.abs(explicitDiscount - normalizedDiscount) <= 0.01;
    const vatCategories = new Set(
      items
        .map((item) =>
          typeof item.vat_category_code === 'string'
            ? item.vat_category_code.trim().toUpperCase()
            : null
        )
        .filter((category): category is string => category != null)
    );
    const preserveExplicitMerchandiseFallback =
      hasAuthoritativeExplicitDiscount && vatCategories.size > 1;
    if (
      !allocationsByLineId &&
      hasUsableExplicitDiscount &&
      (voucherDiscountBasis > 0 || preserveExplicitMerchandiseFallback)
    ) {
      allocationsByLineId = getValidatedExplicitLineDiscounts(
        items,
        lineTotals,
        explicitDiscount,
        explicitLineDiscounts,
        occurrenceOrdinals
      );
      if (!allocationsByLineId) {
        // Compatibility selectors can omit the identity fields needed to
        // match v3 allocations. Preserve the server-authored merchandise
        // total proportionally instead of redistributing VAT-inclusive gross
        // discount across lines with different VAT categories.
        fallbackMerchandiseDiscount = explicitMerchandiseDiscount;
      } else if (voucherDiscountBasis > 0) {
        voucherDiscount = Math.max(0, normalizedDiscount - explicitDiscount);
      }
    }
    if (!allocationsByLineId && voucherDiscountBasis > 0) {
      voucherDiscount = hasUsableExplicitDiscount
        ? Math.max(0, normalizedDiscount - explicitDiscount)
        : normalizedDiscount;
    }
    if (!allocationsByLineId) {
      if (voucherDiscountBasis <= 0) {
        if (!preserveExplicitMerchandiseFallback) {
          const preservesVatRelief =
            options?.discountIncludesVat === true ||
            explicitLineDiscounts.some(
              (allocation) => (allocation?.vatRelief ?? 0) > 0
            );
          return getDiscountedTransactionUnitPrices(
            items,
            normalizedDiscount,
            preservesVatRelief ? { discountIncludesVat: true } : undefined
          );
        }
        // There are no voucher lines to absorb any residual order discount;
        // the explicit merchandise total is the only amount represented in
        // item revenue. VAT relief remains outside merchandise prices.
        voucherDiscount = 0;
      }
      if (voucherDiscountBasis > 0 && explicitDiscount <= 0) {
        voucherDiscount = normalizedDiscount;
      }
    }
    const voucherDiscountRatio =
      voucherDiscountBasis > 0
        ? Math.min(1, voucherDiscount / voucherDiscountBasis)
        : 0;
    const merchandiseDiscountBasis = lineTotals.reduce(
      (sum, line, index) =>
        sum + (voucherLineIndexes.has(index) ? 0 : line.merchandiseTotal),
      0
    );
    const fallbackMerchandiseDiscountRatio =
      merchandiseDiscountBasis > 0
        ? Math.min(1, fallbackMerchandiseDiscount / merchandiseDiscountBasis)
        : 0;

    return unitPrices.map((unitPrice, index) => {
      if (unitPrice < 0) {
        return unitPrice;
      }

      const line = lineTotals[index];
      const item = items[index];
      const allocation =
        allocationsByLineId && item
          ? resolveTransactionDiscountAllocation(
              allocationsByLineId,
              item,
              occurrenceOrdinals?.get(index)
            )
          : undefined;
      if (
        voucherLineIndexes.has(index) &&
        !allocation &&
        line &&
        line.quantity > 0 &&
        line.merchandiseTotal > 0
      ) {
        const persistedVoucherAmount = Math.min(
          line.merchandiseTotal,
          Math.max(
            0,
            toFiniteNumberOrNull(item?.quiz_award_amount) ??
              line.merchandiseTotal
          )
        );
        const merchandiseDiscount =
          persistedVoucherAmount * voucherDiscountRatio;
        return Math.max(0, unitPrice - merchandiseDiscount / line.quantity);
      }
      if (
        !allocationsByLineId &&
        !voucherLineIndexes.has(index) &&
        line &&
        line.quantity > 0 &&
        line.merchandiseTotal > 0 &&
        fallbackMerchandiseDiscountRatio > 0
      ) {
        const merchandiseDiscount =
          line.merchandiseTotal * fallbackMerchandiseDiscountRatio;
        return Math.max(0, unitPrice - merchandiseDiscount / line.quantity);
      }
      if (
        !line ||
        line.quantity <= 0 ||
        !allocation ||
        !Number.isFinite(allocation.merchandiseDiscount) ||
        allocation.merchandiseDiscount <= 0
      ) {
        return unitPrice;
      }

      return Math.max(
        0,
        unitPrice - allocation.merchandiseDiscount / line.quantity
      );
    });
  }

  return applyFallbackTransactionDiscount(
    items,
    unitPrices,
    lineTotals,
    normalizedDiscount,
    options,
    voucherLineIndexes,
    voucherDiscountBasis
  );
}
