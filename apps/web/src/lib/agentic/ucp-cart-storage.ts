import type { CheckoutItem } from '@/lib/agentic/checkout';

export type UcpCartInternalStatus =
  | 'active'
  | 'converted'
  | 'canceled'
  | 'expired';

export type JsonRecord = Record<string, unknown>;

export interface UcpCartSessionRecord {
  id: string;
  agent_id: string | null;
  buyer: JsonRecord;
  cart_id: string;
  cart_items: CheckoutItem[];
  checkout_session_id: string | null;
  created_at?: string;
  currency: string;
  expires_at?: string;
  merchant_id: string;
  metadata: JsonRecord;
  migratedToCartId?: string | null;
  shipping_address: JsonRecord | null;
  status: UcpCartInternalStatus;
  updated_at?: string;
}

/**
 * Thrown when a UCP cart has migrated to the shared canonical cart. Safe
 * and retryable: the caller refreshes onto the canonical cart instead of
 * writing the retired row.
 */
export class UcpCartMigratedError extends Error {
  override readonly name = 'UcpCartMigratedError';
  readonly code = 'refresh_required' as const;
  readonly retryable = true;
  readonly cartId: string | null;
  constructor(cartId?: string | null) {
    super('Agent cart moved to the shared cart; refresh to continue');
    this.cartId = cartId ?? null;
  }
}

/** Guards a UCP write path against retired (migrated) carts. */
export function assertUcpCartNotMigrated(record: {
  migratedToCartId?: string | null;
}): void {
  if (record.migratedToCartId) {
    throw new UcpCartMigratedError(record.migratedToCartId);
  }
}

/**
 * Shared-ownership gate for platform writes: once a cart migrates, its
 * canonical owner is the shared cart, so platform replacement/cancel
 * receives the version-appropriate refresh outcome instead of writing.
 */
export function migratedCartRefreshOutcome(record: {
  migratedToCartId?: string | null;
}): {
  body: { cart_id: string | null; code: string; error: string };
  status: 409;
} | null {
  if (!record.migratedToCartId) return null;
  const migrated = new UcpCartMigratedError(record.migratedToCartId);
  return {
    body: {
      cart_id: migrated.cartId,
      code: migrated.code,
      error: migrated.message,
    },
    status: 409,
  };
}

/**
 * A platform cart stays scoped to its creating caller until explicit
 * handoff/linking. Legacy rows without a recorded caller stay readable
 * by any authenticated merchant agent (compatibility), but a recorded
 * owner mismatch is hidden as not-found.
 */
export function ucpCartCallerMismatch(
  record: { agent_id?: string | null },
  agentId?: string | null
): boolean {
  return Boolean(record.agent_id && record.agent_id !== agentId);
}

/**
 * Maps a database fence violation to the migrated error so late writers
 * get refresh_required; every other error passes through untouched.
 */
export function mapUcpCartWriteError(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string' &&
    (error as { message: string }).message.includes(
      'migrated cart is read-only'
    )
  ) {
    return new UcpCartMigratedError();
  }
  return error;
}

export function buildUcpCartInsert({
  agentId,
  buyer = {},
  cartId,
  currency = 'NGN',
  items,
  merchantId,
  metadata = {},
  shippingAddress = null,
}: {
  agentId?: string | null;
  buyer?: JsonRecord;
  cartId: string;
  currency?: string;
  items: CheckoutItem[];
  merchantId: string;
  metadata?: JsonRecord;
  shippingAddress?: JsonRecord | null;
}) {
  return {
    agent_id: agentId ?? null,
    buyer,
    cart_id: cartId,
    cart_items: items,
    currency: currency.toUpperCase(),
    merchant_id: merchantId,
    metadata,
    shipping_address: shippingAddress,
    status: 'active' as const,
  };
}

export function buildUcpCartUpdate({
  buyer,
  existingBuyer = {},
  items,
  metadata,
  shippingAddress,
}: {
  buyer?: JsonRecord;
  existingBuyer?: JsonRecord;
  items?: CheckoutItem[];
  metadata?: JsonRecord;
  shippingAddress?: JsonRecord | null;
}) {
  return {
    buyer: buyer ?? existingBuyer,
    ...(items ? { cart_items: items } : {}),
    ...(metadata ? { metadata } : {}),
    ...(shippingAddress !== undefined
      ? { shipping_address: shippingAddress }
      : {}),
    status: 'active' as const,
    updated_at: new Date().toISOString(),
  };
}

export function buildUcpCartCheckoutLinkUpdate({
  checkoutSessionId,
}: {
  checkoutSessionId: string;
}) {
  return {
    checkout_session_id: checkoutSessionId,
    status: 'converted' as const,
    updated_at: new Date().toISOString(),
  };
}

export function buildUcpCartStatusUpdate(status: UcpCartInternalStatus) {
  return {
    status,
    updated_at: new Date().toISOString(),
  };
}

export function mapUcpCartStatus(status: UcpCartInternalStatus) {
  return status;
}

export function coerceUcpCartItems(value: unknown): CheckoutItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = item.id;
    const quantity = item.quantity;
    if (
      typeof id !== 'string' ||
      id.trim().length === 0 ||
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      return [];
    }

    return [{ id: id.trim(), quantity }];
  });
}

export function coerceJsonRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function coerceNullableJsonRecord(value: unknown): JsonRecord | null {
  return value === null ? null : coerceJsonRecord(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
