import type { CartErrorCode } from '@baci/shared/cart';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CartPrincipal } from './principal';
import { CartRepositoryError } from './repository';

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

const MAX_OPERATION_ID_LENGTH = 128;

const ERROR_CODES: ReadonlySet<string> = new Set([
  'unauthorized',
  'not_found',
  'expired',
  'version_conflict',
  'idempotency_conflict',
  'invalid_item',
  'cart_locked',
  'refresh_required',
  'temporarily_unavailable',
  'rate_limited',
  'merge_conflict',
  'handoff_consumed',
]);

const UNAVAILABLE_REASONS: ReadonlySet<string> = new Set([
  'offer_invalid',
  'out_of_stock',
  'insufficient_stock',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInteger(value: unknown): value is number {
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

function parseSnapshot(value: unknown): CartCheckoutSnapshot | null {
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

function validOperationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_OPERATION_ID_LENGTH
  );
}

/**
 * Reviews the current authoritative cart for checkout: validated lines,
 * estimates and one active session reference. Replays converge on the
 * stored receipt; version drift answers refresh_required with the live
 * version so the caller reconciles instead of submitting stale lines.
 */
export async function prepareCartCheckout(
  deps: PrepareCartCheckoutDeps,
  input: PrepareCartCheckoutInput
): Promise<PrepareCartCheckoutResult> {
  if (
    deps.principal.scope !== 'session' ||
    !deps.principal.cartId ||
    deps.principal.cartId !== input.cartId
  ) {
    return { code: 'unauthorized', currentVersion: null, ok: false };
  }
  if (
    !validOperationId(input.operationId) ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  ) {
    return { code: 'invalid_item', currentVersion: null, ok: false };
  }
  try {
    const response = await deps.client.rpc('commerce_cart_prepare_checkout', {
      p_cart_id: input.cartId,
      p_expected_version: input.expectedVersion,
      p_operation_id: input.operationId,
    });
    if (response.error) {
      throw new CartRepositoryError(
        'temporarily_unavailable',
        'Cart RPC commerce_cart_prepare_checkout failed'
      );
    }
    const data = response.data;
    if (!isRecord(data) || typeof data.ok !== 'boolean') {
      throw new CartRepositoryError(
        'temporarily_unavailable',
        'Cart RPC commerce_cart_prepare_checkout returned a malformed envelope'
      );
    }
    if (!data.ok) {
      const code =
        typeof data.code === 'string' && ERROR_CODES.has(data.code)
          ? (data.code as CartErrorCode)
          : 'temporarily_unavailable';
      return {
        code,
        currentVersion: isInteger(data.currentVersion)
          ? data.currentVersion
          : null,
        ok: false,
      };
    }
    const snapshot = parseSnapshot(data.snapshot);
    if (!snapshot) {
      throw new CartRepositoryError(
        'temporarily_unavailable',
        'Cart RPC commerce_cart_prepare_checkout returned a malformed snapshot'
      );
    }
    return {
      ok: true,
      replayed: data.replayed === true,
      sessionReused: data.sessionReused === true,
      snapshot,
    };
  } catch (error) {
    if (error instanceof CartRepositoryError) {
      return { code: error.code, currentVersion: null, ok: false };
    }
    return { code: 'temporarily_unavailable', currentVersion: null, ok: false };
  }
}
