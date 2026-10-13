import type {
  CartCommand,
  CartErrorCode,
  CartInputLine,
  CartSnapshot,
  CartWarning,
} from '@baci/shared/cart';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  getPrimaryProductImage,
  PRODUCT_IMAGE_PLACEHOLDER_URL,
} from '@/lib/product-image';
import type { Product } from '@/lib/products';
import { createClient } from '@/lib/supabase/client';

export type SharedCartFetchResult =
  | { ok: true; snapshot: CartSnapshot; warnings: CartWarning[] }
  | {
      ok: false;
      code: CartErrorCode;
      snapshot: CartSnapshot | null;
      retryable: boolean;
    };

export type SharedCartMutationResult =
  | {
      ok: true;
      snapshot: CartSnapshot;
      replayed: boolean;
      warnings: CartWarning[];
    }
  | {
      ok: false;
      code: CartErrorCode;
      snapshot: CartSnapshot | null;
      retryable: boolean;
    };

const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'quota_exceeded',
  'rate_limited',
  'temporarily_unavailable',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSnapshot(value: unknown): value is CartSnapshot {
  return (
    isRecord(value) &&
    typeof value.cartId === 'string' &&
    typeof value.merchantId === 'string' &&
    typeof value.version === 'number' &&
    Array.isArray(value.lines)
  );
}

function warningsOf(value: Record<string, unknown>): CartWarning[] {
  return Array.isArray(value.warnings) ? (value.warnings as CartWarning[]) : [];
}

async function readBody(
  response: Response
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function failureOf(
  body: Record<string, unknown> | null,
  status: number,
  fallback: CartErrorCode = 'temporarily_unavailable'
): Extract<SharedCartFetchResult, { ok: false }> {
  const code = (body?.code as CartErrorCode | undefined) ?? fallback;
  const snapshot =
    body && isSnapshot(body.cart) ? (body.cart as CartSnapshot) : null;
  const retryable =
    status === 429 || status >= 500 || RETRYABLE_CODES.has(code);
  return { code, ok: false, retryable, snapshot };
}

/**
 * Reads the authorized snapshot for the cookie session. Creates nothing:
 * callers bootstrap lazily on the first mutating action instead.
 */
export async function fetchSharedCartSnapshot(
  signal?: AbortSignal
): Promise<SharedCartFetchResult> {
  let response: Response;
  try {
    response = await fetch('/api/storefront/cart', {
      cache: 'no-store',
      credentials: 'same-origin',
      method: 'GET',
      signal,
    });
  } catch {
    return {
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
      snapshot: null,
    };
  }
  const body = await readBody(response);
  if (response.ok && body && isSnapshot(body.cart)) {
    return {
      ok: true,
      snapshot: body.cart as CartSnapshot,
      warnings: warningsOf(body),
    };
  }
  if (response.ok) {
    return {
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
      snapshot: null,
    };
  }
  return failureOf(body, response.status);
}

/**
 * Mints a bounded anonymous retry identity for one merchant. The server
 * sets the session cookie; the body proof is only needed by callers
 * that cannot rely on cookies.
 */
export async function bootstrapSharedCart(
  merchantSlug?: string
): Promise<
  { ok: true } | { ok: false; code: CartErrorCode; retryable: boolean }
> {
  let response: Response;
  try {
    response = await fetchWithCsrf('/api/storefront/cart/bootstrap', {
      body: JSON.stringify(merchantSlug ? { merchantSlug } : {}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  } catch {
    return { code: 'temporarily_unavailable', ok: false, retryable: true };
  }
  if (response.ok) return { ok: true };
  const body = await readBody(response);
  const failure = failureOf(body, response.status);
  return { code: failure.code, ok: false, retryable: failure.retryable };
}

export interface CreateSharedCartInput {
  operationId: string;
  lines?: CartInputLine[];
  currency?: string;
}

export async function createSharedCart(
  input: CreateSharedCartInput
): Promise<SharedCartMutationResult> {
  let response: Response;
  try {
    response = await fetchWithCsrf('/api/storefront/cart', {
      body: JSON.stringify({
        ...(input.currency ? { currency: input.currency } : {}),
        ...(input.lines ? { lines: input.lines } : {}),
        operationId: input.operationId,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  } catch {
    return {
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
      snapshot: null,
    };
  }
  const body = await readBody(response);
  if (response.ok && body && isSnapshot(body.cart)) {
    return {
      ok: true,
      replayed: body.replayed === true,
      snapshot: body.cart as CartSnapshot,
      warnings: warningsOf(body),
    };
  }
  if (response.ok) {
    return {
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
      snapshot: null,
    };
  }
  return failureOf(body, response.status);
}

export interface SendSharedCartCommandInput {
  operationId: string;
  expectedVersion: number;
  command: CartCommand;
}

export async function sendSharedCartCommand(
  input: SendSharedCartCommandInput
): Promise<SharedCartMutationResult> {
  let response: Response;
  try {
    response = await fetchWithCsrf('/api/storefront/cart/commands', {
      body: JSON.stringify({
        command: input.command,
        expectedVersion: input.expectedVersion,
        operationId: input.operationId,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  } catch {
    return {
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
      snapshot: null,
    };
  }
  const body = await readBody(response);
  if (response.ok && body && isSnapshot(body.cart)) {
    return {
      ok: true,
      replayed: body.replayed === true,
      snapshot: body.cart as CartSnapshot,
      warnings: warningsOf(body),
    };
  }
  if (response.ok) {
    return {
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
      snapshot: null,
    };
  }
  return failureOf(body, response.status);
}

export interface SharedCartCheckoutReview {
  checkoutSessionId: string;
  generation: number;
  cartVersion: number;
  cartId: string;
  merchantId: string;
  subtotalMinor: number;
  currency: string;
  unavailableCount: number;
}

export type PrepareSharedCartCheckoutResult =
  | {
      ok: true;
      review: SharedCartCheckoutReview;
      replayed: boolean;
      sessionReused: boolean;
    }
  | {
      ok: false;
      code: CartErrorCode;
      retryable: boolean;
      currentVersion: number | null;
    };

function reviewOf(value: unknown): SharedCartCheckoutReview | null {
  if (!isRecord(value)) return null;
  const estimates = value.estimates;
  if (
    typeof value.checkoutSessionId !== 'string' ||
    typeof value.generation !== 'number' ||
    !Number.isInteger(value.generation) ||
    typeof value.cartVersion !== 'number' ||
    !Number.isInteger(value.cartVersion) ||
    typeof value.cartId !== 'string' ||
    typeof value.merchantId !== 'string' ||
    !isRecord(estimates) ||
    typeof estimates.subtotalMinor !== 'number' ||
    typeof estimates.currency !== 'string' ||
    typeof estimates.unavailableCount !== 'number'
  ) {
    return null;
  }
  return {
    cartId: value.cartId,
    cartVersion: value.cartVersion,
    checkoutSessionId: value.checkoutSessionId,
    currency: estimates.currency,
    generation: value.generation,
    merchantId: value.merchantId,
    subtotalMinor: estimates.subtotalMinor,
    unavailableCount: estimates.unavailableCount,
  };
}

/**
 * Reviews the authoritative cart for checkout. Returns the session
 * reference the order submit binds to; version drift fails with the
 * live version so the caller refreshes instead of submitting stale.
 */
export async function prepareSharedCartCheckout(input: {
  cartId: string;
  expectedVersion: number;
  operationId: string;
}): Promise<PrepareSharedCartCheckoutResult> {
  let response: Response;
  try {
    response = await fetchWithCsrf('/api/storefront/cart/checkout', {
      body: JSON.stringify({
        cartId: input.cartId,
        expectedVersion: input.expectedVersion,
        operationId: input.operationId,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  } catch {
    return {
      code: 'temporarily_unavailable',
      currentVersion: null,
      ok: false,
      retryable: true,
    };
  }
  const body = await readBody(response);
  if (response.ok && body) {
    const review = reviewOf(body.snapshot);
    if (review) {
      return {
        ok: true,
        replayed: body.replayed === true,
        review,
        sessionReused: body.sessionReused === true,
      };
    }
    return {
      code: 'temporarily_unavailable',
      currentVersion: null,
      ok: false,
      retryable: true,
    };
  }
  const failure = failureOf(body, response.status);
  return {
    code: failure.code,
    currentVersion:
      body && typeof body.currentVersion === 'number'
        ? body.currentVersion
        : null,
    ok: false,
    retryable: failure.retryable,
  };
}

const HYDRATION_SELECT =
  'id, name, description, status, price, manage_stock, stock, stock_quantity, has_variants, has_condition_offers, brand, gtin, mpn, merchant_id, images, imageHint:image_hint';

/**
 * Hydrates catalog shells for confirmed lines the client has never seen
 * (another device's lines after a handoff, poll convergence). Mirrors
 * the cart-link transfer select so shells match transfer-added lines.
 * Degrades to an empty map on any failure: unhydrated lines keep
 * rendering as shells with their authoritative totals.
 */
export async function fetchSharedCartProducts(
  productIds: string[],
  merchantId: string
): Promise<Map<string, Product>> {
  const empty = new Map<string, Product>();
  const unique = [...new Set(productIds.filter((id) => id.trim().length > 0))];
  if (unique.length === 0) return empty;
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('products')
      .select(HYDRATION_SELECT)
      .eq('merchant_id', merchantId)
      .in('id', unique)
      .eq('status', 'active');
    if (error || !Array.isArray(data)) return empty;
    const products = new Map<string, Product>();
    for (const row of data as Record<string, unknown>[]) {
      if (typeof row.id !== 'string' || row.status !== 'active') continue;
      const image =
        getPrimaryProductImage(
          Array.isArray(row.images) ? (row.images as string[]) : []
        ) || PRODUCT_IMAGE_PLACEHOLDER_URL;
      products.set(row.id, {
        ...(row as object),
        image,
        imageLarge: image,
      } as Product);
    }
    return products;
  } catch {
    return empty;
  }
}
