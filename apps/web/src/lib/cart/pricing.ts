import type {
  CartErrorCode,
  CartLine,
  CartNegotiationStatus,
  CartSnapshot,
  CartWarning,
} from '@baci/shared/cart';
import type { RawCartLine, RawCartState } from './repository';

export interface PricedSnapshot {
  snapshot: CartSnapshot;
  warnings: CartWarning[];
}

function toNegotiationStatus(
  value: string | null
): CartNegotiationStatus | undefined {
  return value === 'pending' || value === 'accepted' || value === 'rejected'
    ? value
    : undefined;
}

function priceLine(raw: RawCartLine): {
  line: CartLine;
  warnings: CartWarning[];
  estimated: boolean;
} {
  const warnings: CartWarning[] = [];
  let estimated = false;
  const hasVoucher = Boolean(raw.voucherToken && raw.voucherAwardId);

  if (!raw.available) {
    estimated = true;
    warnings.push({
      code: 'unavailable_line',
      lineId: raw.id,
      message:
        'An item is currently unavailable. Totals are estimates until it is removed or back.',
    });
  }
  if (raw.negotiationInvalidated) {
    estimated = true;
    warnings.push({
      code: 'negotiation_invalidated',
      lineId: raw.id,
      message:
        'A negotiated price no longer applies and was reset to the catalog price.',
    });
  }
  if (raw.manageStock && (raw.stockQty ?? 0) <= 0 && raw.available) {
    warnings.push({
      code: 'out_of_stock',
      lineId: raw.id,
      message: 'An item is out of stock. It is kept in your cart for now.',
    });
  }

  // Quiz voucher lines check out at zero, mirroring build-order-items.
  // Only an accepted negotiation prices the line (mirroring the SQL
  // checkout builder); pending/rejected proposals display at catalog.
  const unitPriceMinor = hasVoucher
    ? 0
    : raw.negotiationStatus === 'accepted' &&
        !raw.negotiationInvalidated &&
        raw.negotiatedUnitPriceMinor != null
      ? raw.negotiatedUnitPriceMinor
      : raw.unitPriceMinor;

  const line: CartLine = {
    assuranceRate: raw.assuranceRate ?? undefined,
    hasAssurance: raw.hasAssurance || undefined,
    id: raw.id,
    item: {
      condition:
        raw.condition === 'new' ||
        raw.condition === 'used' ||
        raw.condition === 'open_box' ||
        raw.condition === 'refurbished'
          ? raw.condition
          : undefined,
      ...(raw.offerId ? { offerId: raw.offerId } : {}),
      options: { ...raw.options },
      productId: raw.productId,
      variantId: raw.variantId ?? undefined,
    },
    lineTotalMinor: unitPriceMinor * raw.quantity,
    negotiatedUnitPriceMinor: hasVoucher
      ? undefined
      : raw.negotiationInvalidated
        ? undefined
        : (raw.negotiatedUnitPriceMinor ?? undefined),
    negotiationStatus: hasVoucher
      ? undefined
      : toNegotiationStatus(raw.negotiationStatus),
    quantity: raw.quantity,
    unitPriceMinor,
    voucherAwardId: raw.voucherAwardId ?? undefined,
    voucherToken: raw.voucherToken ?? undefined,
  };
  return { estimated, line, warnings };
}

/**
 * Builds the authoritative snapshot from committed raw state. Pricing is
 * computed here, never trusted from client input: the repository only
 * supplies catalog-validated unit prices and availability flags.
 */
export function buildCartSnapshot(raw: RawCartState): PricedSnapshot {
  const lines: CartLine[] = [];
  const warnings: CartWarning[] = [];
  let estimatedTotals = false;
  let subtotalMinor = 0;
  let assuranceMinor = 0;

  for (const rawLine of raw.lines) {
    const priced = priceLine(rawLine);
    lines.push(priced.line);
    warnings.push(...priced.warnings);
    estimatedTotals = estimatedTotals || priced.estimated;
    subtotalMinor += priced.line.lineTotalMinor;
    // Mirror the order RPC's assurance premium (unit price x quantity
    // x rate, rounded per line) so quoted totals match checkout.
    if (priced.line.hasAssurance && priced.line.assuranceRate) {
      assuranceMinor += Math.round(
        priced.line.unitPriceMinor *
          priced.line.quantity *
          priced.line.assuranceRate
      );
    }
  }

  const snapshot: CartSnapshot = {
    cartId: raw.cartId,
    checkoutSessionId: raw.checkoutSessionId ?? undefined,
    currency: raw.currency,
    estimatedTotals,
    expiresAt: raw.expiresAt,
    lines,
    merchantId: raw.merchantId,
    state: raw.state,
    subtotalMinor,
    totalMinor: subtotalMinor + assuranceMinor,
    version: raw.version,
  };
  return { snapshot, warnings };
}

/** Error codes that may still carry a usable current snapshot. */
export function snapshotCarryingCodes(): CartErrorCode[] {
  return ['version_conflict', 'idempotency_conflict', 'refresh_required'];
}
