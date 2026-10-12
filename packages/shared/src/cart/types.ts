/**
 * Shared server cart contracts.
 *
 * Pure TypeScript types shared by web, mobile, MCP and UCP adapters.
 * Transport validation (Zod) lives with each adapter; this module has no
 * runtime dependencies so every consumer can import it safely.
 */

/** Surface that issued a cart operation. Supplied by the transport. */
export type CartSource = 'web' | 'mobile' | 'mcp' | 'ucp';

/** Lifecycle of a canonical cart. */
export type CartState =
  | 'active'
  | 'checkout'
  | 'completed'
  | 'expired'
  | 'canceled';

/** Product condition values inherited from the existing storefront carts. */
export type CartCondition = 'new' | 'used' | 'open_box' | 'refurbished';

/**
 * Canonical identity of one purchasable line, before quantity.
 * Unknown option keys/values are preserved verbatim in the identity key;
 * catalog validation decides validity server-side.
 */
export interface CartItemIdentity {
  productId: string;
  variantId?: string;
  condition?: CartCondition;
  options?: Record<string, string>;
}

/** One line of cart input: identity plus desired quantity. */
export interface CartInputLine {
  item: CartItemIdentity;
  quantity: number;
}

/** Negotiation state inherited from the existing storefront carts. */
export type CartNegotiationStatus = 'pending' | 'accepted' | 'rejected';

/** One committed line in an authoritative snapshot. */
export interface CartLine {
  id: string;
  item: CartItemIdentity;
  quantity: number;
  /** Catalog unit price in currency minor units. */
  unitPriceMinor: number;
  /** quantity * effective unit price in currency minor units. */
  lineTotalMinor: number;
  negotiatedUnitPriceMinor?: number;
  negotiationStatus?: CartNegotiationStatus;
  voucherToken?: string;
  voucherAwardId?: string;
  hasAssurance?: boolean;
  assuranceRate?: number;
}

export type CartCommand =
  | { type: 'add'; item: CartItemIdentity; quantity: number }
  | { type: 'set_quantity'; lineId: string; quantity: number }
  | { type: 'remove'; lineId: string }
  | { type: 'clear' }
  | { type: 'replace'; lines: CartInputLine[] };

export interface CartMutationInput {
  operationId: string;
  expectedVersion: number;
  command: CartCommand;
}

export interface CreateCartInput {
  operationId: string;
  lines?: CartInputLine[];
  currency?: string;
}

export type CartErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'expired'
  | 'version_conflict'
  | 'idempotency_conflict'
  | 'invalid_item'
  | 'cart_locked'
  | 'refresh_required'
  | 'temporarily_unavailable'
  | 'rate_limited';

export interface CartWarning {
  code: string;
  message: string;
  lineId?: string;
}

/**
 * Authoritative cart snapshot. Contains no access credential or private
 * buyer record.
 */
export interface CartSnapshot {
  cartId: string;
  merchantId: string;
  state: CartState;
  version: number;
  lines: CartLine[];
  currency: string;
  subtotalMinor: number;
  totalMinor: number;
  /** True when totals are estimates pending checkout-time revalidation. */
  estimatedTotals: boolean;
  expiresAt: string;
  checkoutSessionId?: string;
}

export type CartResult =
  | {
      ok: true;
      cart: CartSnapshot;
      operationId: string;
      replayed: boolean;
      warnings: CartWarning[];
    }
  | { ok: false; code: CartErrorCode; cart?: CartSnapshot };

/** Verified session authority. Built server-side, never from body fields. */
export interface VerifiedCartSession {
  merchantId: string;
  /** Null for pre-cart bootstrap proofs, which carry no cart authority. */
  cartId: string | null;
  /** Null for pre-cart bootstrap proofs, which carry no grant authority. */
  grantId: string | null;
  principalId: string;
  allowedOperations: CartCommand['type'][];
  expiresAt: string;
}

/**
 * Checkout preparation result. Contains no reusable cart credential and
 * does not submit an order or initiate payment.
 */
export interface CartCheckoutSnapshot {
  cartId: string;
  merchantId: string;
  version: number;
  lines: CartLine[];
  currency: string;
  subtotalMinor: number;
  totalMinor: number;
  warnings: CartWarning[];
  checkoutSessionId: string;
  expiresAt: string;
}

/**
 * Minimal realtime notification. Routing hint only; receivers refetch the
 * snapshot over an authorized channel.
 */
export interface CartChangeEvent {
  merchantId: string;
  cartId: string;
  version: number;
  operationId: string;
}

/** Maximum lines per cart, inherited from the MCP guest cart (MAX_LINES). */
export const SHARED_CART_MAX_LINES = 20;

/**
 * Maximum quantity per line, inherited from the MCP guest cart line schema.
 */
export const SHARED_CART_MAX_QUANTITY_PER_LINE = 10;

/** Maximum input lines accepted by the legacy web validate endpoint. */
export const SHARED_CART_MAX_VALIDATION_LINES = 50;
