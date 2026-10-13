import type { DiscountableTransactionItem } from './transaction-review-discount-allocations';
import type { TransactionDiscountOptions } from './transaction-review-discount-metadata';
import { toFiniteNumberOrNull } from './transaction-review-row-helpers';

type TransactionDiscountLineTotal = {
  merchandiseTotal: number;
  quantity: number;
  total: number;
};

/** Applies the legacy proportional discount when no usable line allocations exist. */
export function applyFallbackTransactionDiscount(
  items: DiscountableTransactionItem[],
  unitPrices: number[],
  lineTotals: TransactionDiscountLineTotal[],
  normalizedDiscount: number,
  options: TransactionDiscountOptions | undefined,
  voucherLineIndexes: ReadonlySet<number>,
  voucherDiscountBasis: number
) {
  const discountIncludesVat = options?.discountIncludesVat === true;
  const merchandiseOnlyBasis = options?.discountIncludesVat === false;
  const residualDiscount =
    voucherDiscountBasis > 0
      ? Math.max(0, normalizedDiscount - voucherDiscountBasis)
      : 0;
  const residualDiscountBasis =
    voucherDiscountBasis > 0
      ? lineTotals.reduce((sum, line, index) => {
          if (voucherLineIndexes.has(index)) return sum;
          if (!discountIncludesVat) {
            return (
              sum + (merchandiseOnlyBasis ? line.merchandiseTotal : line.total)
            );
          }
          const vatCategory = (
            items[index]?.vat_category_code ?? 'S'
          ).toUpperCase();
          const vatRate =
            vatCategory === 'S'
              ? Math.max(0, toFiniteNumberOrNull(items[index]?.vat_rate) ?? 7.5)
              : 0;
          return sum + line.merchandiseTotal * (1 + vatRate / 100);
        }, 0)
      : 0;
  const discountBasisForFallback =
    voucherDiscountBasis > 0
      ? voucherDiscountBasis
      : discountIncludesVat
        ? lineTotals.reduce((sum, line, index) => {
            const vatCategory = (
              items[index]?.vat_category_code ?? 'S'
            ).toUpperCase();
            const vatRate =
              vatCategory === 'S'
                ? Math.max(
                    0,
                    toFiniteNumberOrNull(items[index]?.vat_rate) ?? 7.5
                  )
                : 0;
            return sum + line.merchandiseTotal * (1 + vatRate / 100);
          }, 0)
        : lineTotals.reduce(
            (sum, line) =>
              sum + (merchandiseOnlyBasis ? line.merchandiseTotal : line.total),
            0
          );
  const discountRatio = Math.min(
    1,
    normalizedDiscount / discountBasisForFallback
  );
  const residualDiscountRatio =
    residualDiscountBasis > 0
      ? Math.min(1, residualDiscount / residualDiscountBasis)
      : 0;

  return unitPrices.map((unitPrice, index) => {
    if (unitPrice < 0) {
      return unitPrice;
    }

    const line = lineTotals[index];
    if (!line || line.quantity <= 0 || line.total <= 0) {
      return unitPrice;
    }

    if (voucherDiscountBasis > 0 && voucherLineIndexes.has(index)) {
      const persistedVoucherAmount = Math.min(
        line.merchandiseTotal,
        Math.max(
          0,
          toFiniteNumberOrNull(items[index]?.quiz_award_amount) ??
            line.merchandiseTotal
        )
      );
      return Math.max(
        0,
        unitPrice - (persistedVoucherAmount * discountRatio) / line.quantity
      );
    }
    if (voucherDiscountBasis > 0 && residualDiscountRatio <= 0) {
      return unitPrice;
    }
    const vatCategory = (items[index]?.vat_category_code ?? 'S').toUpperCase();
    const vatRate =
      discountIncludesVat && vatCategory === 'S'
        ? Math.max(0, toFiniteNumberOrNull(items[index]?.vat_rate) ?? 7.5)
        : 0;
    const lineDiscountRatio =
      voucherDiscountBasis > 0 ? residualDiscountRatio : discountRatio;
    const allocatedDiscount = discountIncludesVat
      ? line.merchandiseTotal * (1 + vatRate / 100) * lineDiscountRatio
      : (merchandiseOnlyBasis ? line.merchandiseTotal : line.total) *
        lineDiscountRatio;
    const taxExclusiveDiscount = allocatedDiscount / (1 + vatRate / 100);
    const merchandiseDiscount =
      discountIncludesVat || merchandiseOnlyBasis
        ? taxExclusiveDiscount
        : taxExclusiveDiscount * (line.merchandiseTotal / line.total);

    return Math.max(0, unitPrice - merchandiseDiscount / line.quantity);
  });
}
