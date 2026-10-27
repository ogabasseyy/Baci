import type {
  CartCommand,
  CartInputLine,
  CartSnapshot,
} from '@baci/shared/cart';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  isCartSessionRetiring,
  runBoundedCartSessionWrite,
} from './cart-session-write-fence';
import { cartClientCredentialHeaders } from './client-credential';
import {
  ensureCartDeviceRevocationCleared,
  isCartDeviceRevocationPending,
} from './shared-cart-session-revoke-client';

export * from './shared-cart-client-support';

import {
  cartRoute,
  failureOf,
  isSnapshot,
  readBody,
  type SharedCartFetchResult,
  type SharedCartMutationResult,
  UNAVAILABLE_FETCH,
  warningsOf,
} from './shared-cart-client-support';

/** Reads the authorized snapshot for the cookie session. */
export function fetchSharedCartSnapshot(
  signal?: AbortSignal,
  merchantSlug?: string | null
): Promise<SharedCartFetchResult> {
  return runBoundedCartSessionWrite(
    merchantSlug,
    UNAVAILABLE_FETCH,
    (requestSignal) => requestSharedCartSnapshot(requestSignal, merchantSlug),
    signal,
    isCartDeviceRevocationPending(merchantSlug)
      ? (requestSignal) =>
          ensureCartDeviceRevocationCleared(merchantSlug, requestSignal)
      : undefined
  );
}

async function requestSharedCartSnapshot(
  signal?: AbortSignal,
  merchantSlug?: string | null
): Promise<SharedCartFetchResult> {
  if (isCartSessionRetiring(merchantSlug)) return UNAVAILABLE_FETCH;
  if (isCartDeviceRevocationPending(merchantSlug)) {
    return UNAVAILABLE_FETCH;
  }
  let response: Response;
  try {
    response = await fetch(cartRoute('/api/storefront/cart', merchantSlug), {
      cache: 'no-store',
      credentials: 'same-origin',
      method: 'GET',
      signal,
    });
  } catch {
    return UNAVAILABLE_FETCH;
  }
  const body = await readBody(response);
  if (response.ok && body && isSnapshot(body.cart)) {
    return {
      ok: true,
      snapshot: body.cart as CartSnapshot,
      warnings: warningsOf(body),
    };
  }
  if (response.ok) return UNAVAILABLE_FETCH;
  return failureOf(body, response.status);
}

export { bootstrapSharedCart } from './shared-cart-bootstrap-client';

export interface CreateSharedCartInput {
  operationId: string;
  lines?: CartInputLine[];
  currency?: string;
}

export function createSharedCart(
  input: CreateSharedCartInput,
  merchantSlug?: string | null
): Promise<SharedCartMutationResult> {
  return runBoundedCartSessionWrite(
    merchantSlug,
    UNAVAILABLE_FETCH,
    (signal) => requestCreateSharedCart(input, merchantSlug, signal),
    undefined,
    isCartDeviceRevocationPending(merchantSlug)
      ? (signal) => ensureCartDeviceRevocationCleared(merchantSlug, signal)
      : undefined
  );
}

async function requestCreateSharedCart(
  input: CreateSharedCartInput,
  merchantSlug?: string | null,
  signal?: AbortSignal
): Promise<SharedCartMutationResult> {
  if (isCartDeviceRevocationPending(merchantSlug)) {
    return UNAVAILABLE_FETCH;
  }
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
        headers: {
          'Content-Type': 'application/json',
          ...cartClientCredentialHeaders(),
        },
        method: 'POST',
        signal,
      }
    );
  } catch {
    return UNAVAILABLE_FETCH;
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
  if (response.ok) return UNAVAILABLE_FETCH;
  return failureOf(body, response.status);
}

export interface SendSharedCartCommandInput {
  operationId: string;
  expectedVersion: number;
  command: CartCommand;
}

export function sendSharedCartCommand(
  input: SendSharedCartCommandInput,
  merchantSlug?: string | null
): Promise<SharedCartMutationResult> {
  return runBoundedCartSessionWrite(
    merchantSlug,
    UNAVAILABLE_FETCH,
    (signal) => requestSharedCartCommand(input, merchantSlug, signal),
    undefined,
    isCartDeviceRevocationPending(merchantSlug)
      ? (signal) => ensureCartDeviceRevocationCleared(merchantSlug, signal)
      : undefined
  );
}

async function requestSharedCartCommand(
  input: SendSharedCartCommandInput,
  merchantSlug?: string | null,
  signal?: AbortSignal
): Promise<SharedCartMutationResult> {
  if (isCartSessionRetiring(merchantSlug)) return UNAVAILABLE_FETCH;
  if (isCartDeviceRevocationPending(merchantSlug)) {
    return UNAVAILABLE_FETCH;
  }
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
        signal,
      }
    );
  } catch {
    return UNAVAILABLE_FETCH;
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
  if (response.ok) return UNAVAILABLE_FETCH;
  return failureOf(body, response.status);
}

export * from './shared-cart-checkout-client';
export * from './shared-cart-products';
