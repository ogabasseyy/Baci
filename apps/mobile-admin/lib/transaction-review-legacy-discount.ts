import { MAX_AUTO_NEGOTIATION_DISCOUNT_RATE } from '@baci/shared';
import { toFiniteNumberOrNull } from './transaction-review-row-helpers';
import type { TransactionReviewOrderRow } from './transaction-review-types';

function hasPersistedTransactionDiscountMetadata(adTracking: unknown) {
  return (
    typeof adTracking === 'object' &&
    adTracking !== null &&
    !Array.isArray(adTracking) &&
    Object.hasOwn(adTracking, 'baci_transaction_discount')
  );
}

/**
 * Recognizes the capped auto-negotiation shape when older rows lack the
 * server-authored marker. Current admin edits and historical edits recorded in
 * order_audit_events are marked as admin edits before this heuristic runs;
 * discount-code and non-storefront sources stay on the ordinary path because
 * their discount provenance is different.
 */
export function isLegacyVatInclusiveNegotiationDiscount(
  order: TransactionReviewOrderRow,
  orderItems: NonNullable<TransactionReviewOrderRow['order_items']>
) {
  return (
    getLegacyNegotiationDiscountOptions(order, orderItems)
      ?.discountIncludesVat === true
  );
}

export function getLegacyNegotiationDiscountOptions(
  order: TransactionReviewOrderRow,
  orderItems: NonNullable<TransactionReviewOrderRow['order_items']>
) {
  if (
    hasPersistedTransactionDiscountMetadata(order.ad_tracking) ||
    order.discount_code_id != null ||
    !['online_store', 'mobile_app'].includes(order.source?.toLowerCase() ?? '')
  ) {
    return undefined;
  }

  const discountAmount = Math.max(
    0,
    toFiniteNumberOrNull(order.discount_amount) ?? 0
  );
  if (discountAmount <= 0) {
    return undefined;
  }

  const taxAmount = Math.max(0, toFiniteNumberOrNull(order.tax_amount) ?? 0);
  const vatCategories = new Set(
    orderItems.map((item) => {
      const category = item.vat_category_code?.trim().toUpperCase();
      return category || null;
    })
  );
  // A pre-metadata order does not tell us which line supplied the negotiated
  // discount's VAT component. Do not infer VAT relief from tax collected on a
  // different category in a mixed-VAT order; the fallback must stay
  // merchandise-only unless line-level provenance established the component.
  const discountIncludesVat =
    taxAmount > 0 && vatCategories.size === 1 && vatCategories.has('S');

  const maxNegotiationDiscount = orderItems.reduce((sum, item) => {
    const price = Math.max(0, toFiniteNumberOrNull(item.price) ?? 0);
    const quantity = Math.max(0, toFiniteNumberOrNull(item.quantity) ?? 1);
    if (price <= 0 || quantity <= 0) {
      return sum;
    }
    const vatCategory = item.vat_category_code?.trim().toUpperCase();
    const vatRate =
      discountIncludesVat && vatCategory === 'S'
        ? Math.max(0, toFiniteNumberOrNull(item.vat_rate) ?? 7.5)
        : 0;
    return (
      sum +
      price *
        quantity *
        MAX_AUTO_NEGOTIATION_DISCOUNT_RATE *
        (1 + vatRate / 100)
    );
  }, 0);

  return discountAmount <= maxNegotiationDiscount + 0.01
    ? { discountIncludesVat }
    : undefined;
}
