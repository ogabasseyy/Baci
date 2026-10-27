import type { CartSnapshot } from '@baci/shared/cart';
import { fetchWithCsrf } from '@/lib/api-client';
import type { CartAccountLinkInput } from '@/schemas/cart-account';
import { withCartRequestDeadline } from './cart-request-deadline';
import { runCartSessionTransition } from './cart-session-write-fence';
import {
  cartRoute,
  failureOf,
  isSnapshot,
  readBody,
  type SharedCartMutationResult,
  warningsOf,
} from './shared-cart-client';
import { isCartDeviceRevocationPending } from './shared-cart-session-revoke-client';

/**
 * Explicit account choice. The caller keeps one operationId until the
 * outcome is known, so a lost response replays the committed link
 * instead of linking twice.
 */
export function linkAccountCart(
  input: CartAccountLinkInput,
  merchantSlug?: string | null
): Promise<SharedCartMutationResult> {
  if (isCartDeviceRevocationPending(merchantSlug))
    return Promise.resolve({
      ok: false,
      code: 'temporarily_unavailable',
      retryable: true,
      snapshot: null,
    });
  return runCartSessionTransition<SharedCartMutationResult>(
    merchantSlug,
    {
      ok: false,
      code: 'temporarily_unavailable',
      retryable: true,
      snapshot: null,
    },
    () =>
      withCartRequestDeadline<SharedCartMutationResult>(
        {
          ok: false,
          code: 'temporarily_unavailable',
          retryable: true,
          snapshot: null,
        },
        (signal) => requestAccountCartLink(input, merchantSlug, signal)
      ),
    {
      isSuccessful: (result) => result.ok,
      operationId: input.operationId,
      canRetry: (result) => !result.ok && result.retryable,
    }
  );
}
async function requestAccountCartLink(
  input: CartAccountLinkInput,
  merchantSlug?: string | null,
  signal?: AbortSignal
): Promise<SharedCartMutationResult> {
  let response: Response;
  try {
    response = await fetchWithCsrf(
      cartRoute('/api/storefront/cart/account', merchantSlug),
      {
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal,
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
