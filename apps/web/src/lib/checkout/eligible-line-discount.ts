import {
  buildTransactionDiscountLineKey,
  buildTransactionDiscountLineOccurrenceKey,
  MAX_AUTO_NEGOTIATION_DISCOUNT_RATE,
  type TransactionDiscountLineAllocation,
} from '@baci/shared';

// ±1 NGN tolerance mirrors the RPC's parity tolerances so display rounding is
// not mistaken for tampering / breaking the floor.
const PRICE_TOLERANCE = 1;

export interface NegotiationLineInput {
  catalogUnitPrice: number;
  clientUnitPrice: number;
  /** Persistent order_items.line_id (one-based) when the caller has it. */
  lineId?: number;
  /** Persisted order-item identity used to match allocations after RPC reads. */
  productId: string;
  variantId: string | null;
  condition?: string | null;
  variantAttributes?: Record<string, string> | null;
  quantity: number;
  negotiable: boolean;
  vatCategoryCode: string | null;
  vatRate: number | null;
}

export type EligibleLineRejectionCode =
  | 'non_negotiable_line_discounted'
  | 'negotiated_price_below_floor';

export type EligibleLineDiscountAllocation = TransactionDiscountLineAllocation;

export interface EligibleLineDiscountResult {
  totalDiscount: number;
  // Non-null when the order must be rejected: a non-negotiable (budget-brand /
  // Samsung A) line was priced below catalog, or a negotiable line was priced
  // more than `maxRate` below catalog. Rejecting (not clamping) the below-floor
  // case also bounds the assurance fee, which /api/orders derives from the line
  // price — a within-floor line ⇒ assurance ≤ maxRate below catalog too.
  rejectionCode: EligibleLineRejectionCode | null;
  // Aligned with the input lines so order history can preserve the negotiated
  // line boundaries instead of redistributing one order total.
  lineDiscounts?: Array<EligibleLineDiscountAllocation | null>;
}

// Mirrors roundToCents in checkout-order-tax.ts and the RPC trigger formula.
function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeEligibleLineDiscount(
  lines: NegotiationLineInput[],
  maxRate: number = MAX_AUTO_NEGOTIATION_DISCOUNT_RATE
): EligibleLineDiscountResult {
  let totalDiscount = 0;
  const lineDiscounts: Array<EligibleLineDiscountAllocation | null> = [];
  const productVariantCounts = new Map<string, number>();
  const lineKeyCounts = new Map<string, number>();
  for (const line of lines) {
    const identity = JSON.stringify([line.productId, line.variantId]);
    productVariantCounts.set(
      identity,
      (productVariantCounts.get(identity) ?? 0) + 1
    );
    const lineKey = buildTransactionDiscountLineKey({
      condition: line.condition,
      productId: line.productId,
      variantAttributes: line.variantAttributes,
      variantId: line.variantId,
    });
    lineKeyCounts.set(lineKey, (lineKeyCounts.get(lineKey) ?? 0) + 1);
  }

  const lineKeyOccurrences = new Map<string, number>();

  for (const [lineIndex, lineInput] of lines.entries()) {
    const resolvedLineId =
      typeof lineInput.lineId === 'number' &&
      Number.isInteger(lineInput.lineId) &&
      lineInput.lineId > 0
        ? lineInput.lineId
        : lineIndex + 1;
    const outputLineIndex = resolvedLineId - 1;
    lineDiscounts[outputLineIndex] = null;
    const lineKey = buildTransactionDiscountLineKey({
      condition: lineInput.condition,
      productId: lineInput.productId,
      variantAttributes: lineInput.variantAttributes,
      variantId: lineInput.variantId,
    });
    const occurrenceOrdinal = (lineKeyOccurrences.get(lineKey) ?? 0) + 1;
    lineKeyOccurrences.set(lineKey, occurrenceOrdinal);
    const quantity = Number(lineInput.quantity);
    const catalogUnit = Number(lineInput.catalogUnitPrice);
    const clientUnit = Number(lineInput.clientUnitPrice);
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(catalogUnit) ||
      catalogUnit < 0 ||
      !Number.isFinite(clientUnit) ||
      clientUnit < 0
    ) {
      // The route validates items separately; skip defensively here.
      continue;
    }

    const catalogLine = roundToCents(catalogUnit * quantity);
    const clientLine = roundToCents(clientUnit * quantity);
    // Only standard-rated ('S') lines carry VAT — matches the order_items
    // trigger and computeAgenticOrderTax exactly.
    const rawRate =
      (lineInput.vatCategoryCode ?? 'S') === 'S'
        ? Number(lineInput.vatRate ?? 7.5)
        : 0;
    const rate = Number.isFinite(rawRate) && rawRate >= 0 ? rawRate : 0;

    if (!lineInput.negotiable) {
      if (catalogLine - clientLine > PRICE_TOLERANCE) {
        return {
          totalDiscount: 0,
          rejectionCode: 'non_negotiable_line_discounted',
        };
      }
      continue;
    }

    const reduction = catalogLine - clientLine;
    if (reduction <= 0) {
      // At or above catalog → no discount for this line.
      continue;
    }
    // The 2% floor is on the price (subtotal) reduction.
    const maxReduction = roundToCents(catalogLine * maxRate);
    if (reduction - maxReduction > PRICE_TOLERANCE) {
      return {
        totalDiscount: 0,
        rejectionCode: 'negotiated_price_below_floor',
      };
    }
    // The persisted order line stays at CATALOG price (the RPC ignores client
    // prices), so its VAT is on the full catalog line. The discount must also
    // absorb the VAT on the reduction for the gateway total to equal the
    // negotiated total the customer saw.
    const reductionVat = roundToCents((reduction * rate) / 100);
    totalDiscount = roundToCents(totalDiscount + reduction + reductionVat);
    const allocation: EligibleLineDiscountAllocation = {
      lineId: resolvedLineId,
      merchandiseDiscount: reduction,
      productId: lineInput.productId,
      vatRelief: reductionVat,
      variantId: lineInput.variantId,
    };
    if (
      (productVariantCounts.get(
        JSON.stringify([lineInput.productId, lineInput.variantId])
      ) ?? 0) > 1
    ) {
      allocation.lineKey =
        (lineKeyCounts.get(lineKey) ?? 0) === 1
          ? lineKey
          : buildTransactionDiscountLineOccurrenceKey(
              lineKey,
              occurrenceOrdinal
            );
    }
    lineDiscounts[outputLineIndex] = allocation;
  }

  return {
    totalDiscount,
    rejectionCode: null,
    ...(lineDiscounts.some(Boolean)
      ? {
          lineDiscounts: Array.from(
            { length: lineDiscounts.length },
            (_, index) => lineDiscounts[index] ?? null
          ),
        }
      : {}),
  };
}
