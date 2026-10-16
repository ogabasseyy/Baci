/**
 * Shared cart-validation key protocol, imported by both the
 * /api/cart/validate route (key producer) and applyValidationResults
 * (key consumer). One module so the shapes cannot drift: a key the
 * server emits must mean the same thing the client filter matches.
 */

export type QuizVoucherLineLike = {
  quizAwardId?: string | null;
  quizVoucherToken?: string | null;
};

/**
 * Lines carrying either quiz-voucher proof redeem pre-reserved units
 * outside every shared pool — the server excludes them from the
 * strict serialized aggregate, and the client must never remove them
 * on a product-wide or sibling-line invalidation signal.
 */
export function isQuizVoucherLine(item: QuizVoucherLineLike): boolean {
  return Boolean(item.quizAwardId || item.quizVoucherToken);
}

/**
 * Base-line-scoped invalidation key. A bare product id means
 * product-wide (dead/inactive product: remove every line), so a
 * pool-oversubscribed base line needs its own shape — otherwise the
 * filter would also remove the exempt voucher sibling sharing the
 * product id.
 */
export function getBaseLineValidationKey(productId: string): string {
  return `${productId}::base`;
}
