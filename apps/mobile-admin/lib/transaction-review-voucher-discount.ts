import type { DiscountableTransactionItem } from './transaction-review-discount-allocations';
import { toFiniteNumberOrNull } from './transaction-review-row-helpers';

export function isQuizVoucherLine(item: DiscountableTransactionItem) {
  const awardId = item.quiz_award_id;
  const awardAmount = toFiniteNumberOrNull(item.quiz_award_amount);
  return (
    (typeof awardId === 'string' && awardId.trim().length > 0) ||
    (awardAmount != null && awardAmount > 0)
  );
}

export function getQuizVoucherDiscountAmount(
  items: DiscountableTransactionItem[]
) {
  return items.reduce((sum, item) => {
    if (!isQuizVoucherLine(item)) {
      return sum;
    }

    const merchandiseTotal =
      Math.max(0, toFiniteNumberOrNull(item.price) ?? 0) *
      Math.max(0, toFiniteNumberOrNull(item.quantity) ?? 1);
    const voucherAmount = toFiniteNumberOrNull(item.quiz_award_amount);
    return (
      sum +
      Math.min(merchandiseTotal, Math.max(0, voucherAmount ?? merchandiseTotal))
    );
  }, 0);
}
