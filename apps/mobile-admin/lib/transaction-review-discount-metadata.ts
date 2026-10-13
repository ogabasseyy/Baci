import {
  TRANSACTION_DISCOUNT_METADATA_KEY,
  type TransactionDiscountLineAllocation,
} from '@baci/shared/contracts';
import { toPositiveInteger } from './transaction-review-positive-integer';
import { toFiniteNumberOrNull } from './transaction-review-row-helpers';

export interface TransactionDiscountOptions {
  /**
   * Explicit per-line merchandise reductions persisted by the checkout route.
   * A present array is authoritative: null entries are intentionally left at
   * their recorded price because the negotiated discount did not originate on
   * that line.
   */
  lineDiscounts?: Array<TransactionDiscountLineAllocation | null>;
  /** Legacy auto-negotiated discounts included relief for standard VAT. */
  discountIncludesVat?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads only the server-authored checkout marker from the order's persisted
 * ad-tracking JSON. Invalid or client-shaped metadata is ignored so ordinary
 * order discounts continue through the proportional fallback.
 */
export function parseTransactionDiscountOptions(
  adTracking: unknown
): TransactionDiscountOptions | undefined {
  if (!isRecord(adTracking)) {
    return undefined;
  }

  const metadata = adTracking[TRANSACTION_DISCOUNT_METADATA_KEY];
  if (
    !isRecord(metadata) ||
    (metadata.version !== 2 && metadata.version !== 3)
  ) {
    return undefined;
  }

  if (!Array.isArray(metadata.lineDiscounts)) {
    return undefined;
  }

  let hasInvalidLine = false;
  const lineIds = new Set<number>();
  const lineKeys = new Set<string>();
  const lineDiscounts = metadata.lineDiscounts.map((line) => {
    if (line === null) {
      return null;
    }
    if (!isRecord(line)) {
      hasInvalidLine = true;
      return null;
    }

    const lineId = toPositiveInteger(line.lineId);
    const merchandiseDiscount = toFiniteNumberOrNull(line.merchandiseDiscount);
    const vatRelief = toFiniteNumberOrNull(line.vatRelief);
    const productId =
      typeof line.productId === 'string' && line.productId.trim().length > 0
        ? line.productId
        : null;
    const variantId =
      line.variantId === null || typeof line.variantId === 'string'
        ? line.variantId
        : undefined;
    const lineIdentity =
      productId == null || variantId === undefined
        ? null
        : JSON.stringify([productId, variantId]);
    const lineKey =
      typeof line.lineKey === 'string' && line.lineKey.length > 0
        ? line.lineKey
        : null;
    const persistedIdentity = lineKey ?? lineIdentity;
    if (
      lineId == null ||
      lineIds.has(lineId) ||
      merchandiseDiscount == null ||
      merchandiseDiscount < 0 ||
      vatRelief == null ||
      vatRelief < 0 ||
      (metadata.version === 3 &&
        (persistedIdentity == null || lineKeys.has(persistedIdentity)))
    ) {
      hasInvalidLine = true;
      return null;
    }
    lineIds.add(lineId);
    if (persistedIdentity != null) {
      lineKeys.add(persistedIdentity);
    }
    return merchandiseDiscount > 0 || vatRelief > 0
      ? {
          lineId,
          ...(lineKey ? { lineKey } : {}),
          merchandiseDiscount,
          ...(metadata.version === 3
            ? { productId: productId as string, variantId: variantId ?? null }
            : {}),
          vatRelief,
        }
      : null;
  });

  if (hasInvalidLine) {
    return undefined;
  }

  return { lineDiscounts };
}
