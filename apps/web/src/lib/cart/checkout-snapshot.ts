import type { CartErrorCode } from '@baci/shared/cart';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CartPrincipal } from './principal';
import { isRecord } from './repository-envelope';

export interface CartCheckoutLine {
  id: string;
  productId: string;
  variantId: string | null;
  condition: string | null;
  options: Record<string, string>;
  quantity: number;
  negotiatedUnitPriceMinor: number | null;
  negotiationStatus: string | null;
  negotiationInvalidated: boolean;
  voucherToken: string | null;
  voucherAwardId: string | null;
  hasAssurance: boolean;
  assuranceRate: number | null;
  lastUnitPriceMinor: number | null;
  validatedUnitPriceMinor: number;
  effectiveUnitPriceMinor: number;
  priceChanged: boolean;
  available: boolean;
  unavailableReason:
    | 'offer_invalid'
    | 'out_of_stock'
    | 'insufficient_stock'
    | null;
  stockQty: number;
  manageStock: boolean;
}

export interface CartCheckoutEstimates {
  subtotalMinor: number;
  currency: string;
  lineCount: number;
  unavailableCount: number;
}

/**
 * Authoritative checkout review. Pins the reviewed cart version plus one
 * active checkout session reference. It never submits an order or starts
 * payment; the binding RPC revalidates everything at submit time.
 */
export interface CartCheckoutSnapshot {
  checkoutSessionId: string;
  generation: number;
  cartVersion: number;
  cartId: string;
  merchantId: string;
  lines: CartCheckoutLine[];
  estimates: CartCheckoutEstimates;
}

export type PrepareCartCheckoutResult =
  | {
      ok: true;
      snapshot: CartCheckoutSnapshot;
      replayed: boolean;
      sessionReused: boolean;
    }
  | { ok: false; code: CartErrorCode; currentVersion: number | null };

export interface PrepareCartCheckoutDeps {
  client: SupabaseClient;
  principal: CartPrincipal;
}

export interface PrepareCartCheckoutInput {
  cartId: string;
  expectedVersion: number;
  operationId: string;
}

export const MAX_OPERATION_ID_LENGTH = 128;

export const UNAVAILABLE_REASONS: ReadonlySet<string> = new Set([
  'offer_invalid',
  'out_of_stock',
  'insufficient_stock',
]);

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function parseOptions(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

function parseLine(value: unknown): CartCheckoutLine | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.productId !== 'string' ||
    !isInteger(value.quantity) ||
    !isInteger(value.validatedUnitPriceMinor) ||
    !isInteger(value.effectiveUnitPriceMinor) ||
    typeof value.priceChanged !== 'boolean' ||
    typeof value.available !== 'boolean' ||
    typeof value.stockQty !== 'number'
  ) {
    return null;
  }
  const unavailableReason = value.unavailableReason;
  if (
    unavailableReason !== null &&
    (typeof unavailableReason !== 'string' ||
      !UNAVAILABLE_REASONS.has(unavailableReason))
  ) {
    return null;
  }
  return {
    assuranceRate:
      typeof value.assuranceRate === 'number' ? value.assuranceRate : null,
    available: value.available,
    condition: typeof value.condition === 'string' ? value.condition : null,
    effectiveUnitPriceMinor: value.effectiveUnitPriceMinor,
    hasAssurance: value.hasAssurance === true,
    id: value.id,
    lastUnitPriceMinor: isInteger(value.lastUnitPriceMinor)
      ? value.lastUnitPriceMinor
      : null,
    manageStock: value.manageStock !== false,
    negotiatedUnitPriceMinor: isInteger(value.negotiatedUnitPriceMinor)
      ? value.negotiatedUnitPriceMinor
      : null,
    negotiationInvalidated: value.negotiationInvalidated === true,
    negotiationStatus:
      typeof value.negotiationStatus === 'string'
        ? value.negotiationStatus
        : null,
    options: parseOptions(value.options),
    priceChanged: value.priceChanged,
    productId: value.productId,
    quantity: value.quantity,
    stockQty: value.stockQty,
    unavailableReason:
      (unavailableReason as CartCheckoutLine['unavailableReason']) ?? null,
    validatedUnitPriceMinor: value.validatedUnitPriceMinor,
    variantId: typeof value.variantId === 'string' ? value.variantId : null,
    voucherAwardId:
      typeof value.voucherAwardId === 'string' ? value.voucherAwardId : null,
    voucherToken:
      typeof value.voucherToken === 'string' ? value.voucherToken : null,
  };
}

function parseEstimates(value: unknown): CartCheckoutEstimates | null {
  if (!isRecord(value)) return null;
  if (
    !isInteger(value.subtotalMinor) ||
    typeof value.currency !== 'string' ||
    !isInteger(value.lineCount) ||
    !isInteger(value.unavailableCount)
  ) {
    return null;
  }
  return {
    currency: value.currency,
    lineCount: value.lineCount,
    subtotalMinor: value.subtotalMinor,
    unavailableCount: value.unavailableCount,
  };
}

export function parseSnapshot(value: unknown): CartCheckoutSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.checkoutSessionId !== 'string' ||
    !isInteger(value.generation) ||
    !isInteger(value.cartVersion) ||
    typeof value.cartId !== 'string' ||
    typeof value.merchantId !== 'string' ||
    !Array.isArray(value.lines)
  ) {
    return null;
  }
  const lines: CartCheckoutLine[] = [];
  for (const entry of value.lines) {
    const parsed = parseLine(entry);
    if (!parsed) return null;
    lines.push(parsed);
  }
  const estimates = parseEstimates(value.estimates);
  if (!estimates) return null;
  return {
    cartId: value.cartId,
    cartVersion: value.cartVersion,
    checkoutSessionId: value.checkoutSessionId,
    estimates,
    generation: value.generation,
    lines,
    merchantId: value.merchantId,
  };
}

export function validOperationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_OPERATION_ID_LENGTH
  );
}
