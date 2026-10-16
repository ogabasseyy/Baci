import type {
  CartCommand,
  CartErrorCode,
  CartInputLine,
  CartSnapshot,
  CartWarning,
} from '@baci/shared/cart';

import { fetchWithCsrf } from '@/lib/api-client';

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

export const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'quota_exceeded',
  'rate_limited',
  'temporarily_unavailable',
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isSnapshot(value: unknown): value is CartSnapshot {
  return (
    isRecord(value) &&
    typeof value.cartId === 'string' &&
    typeof value.merchantId === 'string' &&
    typeof value.version === 'number' &&
    Array.isArray(value.lines)
  );
}

export function warningsOf(value: Record<string, unknown>): CartWarning[] {
  return Array.isArray(value.warnings) ? (value.warnings as CartWarning[]) : [];
}

/** The route validates this hint against its trusted host and proof. */
export function cartRoute(path: string, merchantSlug?: string | null): string {
  return merchantSlug
    ? `${path}?merchantSlug=${encodeURIComponent(merchantSlug)}`
    : path;
}

export async function readBody(
  response: Response
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function failureOf(
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
  signal?: AbortSignal,
  merchantSlug?: string | null
): Promise<SharedCartFetchResult> {
  let response: Response;
  try {
    response = await fetch(cartRoute('/api/storefront/cart', merchantSlug), {
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
const inFlightBootstraps = new Map<
  string,
  Promise<{ ok: true } | { ok: false; code: CartErrorCode; retryable: boolean }>
>();

/**
 * Bootstrap is single-flight per merchant: two concurrent bootstraps
 * can both leave without a live-session cookie, and whichever
 * Set-Cookie lands last wins — a cart-less bootstrap proof arriving
 * after provisioning would overwrite the proof bound to the
 * just-created cart and orphan it.
 */
export function bootstrapSharedCart(
  merchantSlug?: string
): Promise<
  { ok: true } | { ok: false; code: CartErrorCode; retryable: boolean }
> {
  const key = merchantSlug ?? '';
  const inFlight = inFlightBootstraps.get(key);
  if (inFlight) return inFlight;
  const pending = requestBootstrap(merchantSlug).finally(() => {
    inFlightBootstraps.delete(key);
  });
  inFlightBootstraps.set(key, pending);
  return pending;
}

async function requestBootstrap(
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
  input: CreateSharedCartInput,
  merchantSlug?: string | null
): Promise<SharedCartMutationResult> {
  let response: Response;
  try {
    response = await fetchWithCsrf(
      cartRoute('/api/storefront/cart', merchantSlug),
      {
        body: JSON.stringify({
          ...(input.currency ? { currency: input.currency } : {}),
          ...(input.lines ? { lines: input.lines } : {}),
          operationId: input.operationId,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );
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
  input: SendSharedCartCommandInput,
  merchantSlug?: string | null
): Promise<SharedCartMutationResult> {
  let response: Response;
  try {
    response = await fetchWithCsrf(
      cartRoute('/api/storefront/cart/commands', merchantSlug),
      {
        body: JSON.stringify({
          command: input.command,
          expectedVersion: input.expectedVersion,
          operationId: input.operationId,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );
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

export * from './shared-cart-checkout-client';
export * from './shared-cart-products';
