import { fetchWithCsrf } from '@/lib/api-client';
import { hasActiveCartCookieWrite } from './cart-cross-tab-lock';
import {
  beginDeferredCartLogout,
  endDeferredCartLogout,
  isDeferredCartLogout,
  reconcileOrphanedDeferredCartLogout,
} from './cart-deferred-logout';
import { withCartRequestDeadline } from './cart-request-deadline';
import {
  beginCartSessionRetirement,
  isCartSessionRetirementReady,
  isCartSessionRetiring,
} from './cart-session-write-fence';
import { clearSharedCartImportReceipt } from './cart-storage';
import { eraseRetiredCartCache } from './retired-cart-cache';

export {
  beginDeferredCartLogout,
  endDeferredCartLogout,
  reconcileOrphanedDeferredCartLogout,
};

/**
 * Abandon a deferred logout whose auth request failed: the customer is
 * still signed in, so lift the revocation fence WITHOUT erasing the
 * parked cache, which the replacement session re-imports.
 */
export function cancelDeferredCartLogout(merchantSlug?: string | null): void {
  endDeferredCartLogout(merchantSlug);
  clearCartDeviceRevocationPending(merchantSlug);
}

export {
  clearCartDeviceRevocationPending,
  clearCartDeviceSessionActive,
  hasActiveCartDeviceSession,
  isCartDeviceRevocationPending,
  markCartDeviceRevocationPending,
  markCartDeviceSessionActive,
  resetPendingCartDeviceRevocationsForTests,
} from './cart-device-session-markers';

import {
  clearCartDeviceRevocationPending,
  clearCartDeviceSessionActive,
  hasActiveCartDeviceSession,
  isCartDeviceRevocationPending,
  markCartDeviceRevocationPending,
} from './cart-device-session-markers';

function revokeRoute(merchantSlug?: string | null): string {
  return merchantSlug
    ? `/api/storefront/cart/session/revoke?merchantSlug=${encodeURIComponent(merchantSlug)}`
    : '/api/storefront/cart/session/revoke';
}

async function readRevokeBody(
  response: Response
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Device-scoped revocation on sign-out; never clears the shared cart. */
export async function revokeCartDeviceSession(
  merchantSlug?: string | null,
  options?: {
    fenceOnFailure?: boolean;
    signal?: AbortSignal;
    drainActiveWrites?: boolean;
    deferCacheErasure?: boolean;
    retiringUserId?: string | null;
  }
): Promise<{ ok: boolean }> {
  const request = () =>
    withCartRequestDeadline(
      { ok: false },
      (signal) =>
        requestDeviceRevocation(
          merchantSlug,
          signal,
          options?.deferCacheErasure,
          options?.retiringUserId
        ),
      options?.signal
    );
  // Passive cleanup must never request an exclusive lock while running
  // inside a shared writer. Its lifecycle retry runs outside that writer.
  const result = isCartSessionRetirementReady(merchantSlug)
    ? await request()
    : hasActiveCartCookieWrite() && !options?.drainActiveWrites
      ? { ok: false }
      : await (async () => {
          if (isCartSessionRetiring(merchantSlug)) return { ok: false };
          const retirement = beginCartSessionRetirement(merchantSlug ?? '');
          try {
            await retirement.drained;
            return await request();
          } catch {
            return { ok: false };
          } finally {
            retirement.release();
          }
        })();
  if (!result.ok && options?.fenceOnFailure !== false)
    markCartDeviceRevocationPending(merchantSlug);
  return result;
}
async function requestDeviceRevocation(
  merchantSlug: string | null | undefined,
  signal: AbortSignal,
  deferCacheErasure?: boolean,
  retiringUserId?: string | null
): Promise<{ ok: boolean }> {
  try {
    const response = await fetchWithCsrf(revokeRoute(merchantSlug), {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    });
    const body = await readRevokeBody(response);
    if (signal.aborted) return { ok: false };
    // No proof means no cart authority exists to retire (ordinary
    // legacy logout). A definitively invalid proof (for example after
    // a signing-key rotation) can never be repaired by retrying and
    // authorizes nothing, so it is likewise already retired. A proof
    // expired past the revocation grace is terminal for the same
    // reason and must not block customer logout forever.
    const ok = response.ok
      ? body?.revoked === true
      : response.status === 401 &&
        (body?.code === 'missing_proof' ||
          body?.code === 'invalid_proof' ||
          body?.code === 'expired_proof');
    if (ok) {
      // A pending retirement parks the previous account's cache. Erase it
      // before releasing access: provisioning and preserved-session adoption
      // read this key directly after passive revocation succeeds. Logout
      // defers this (and the fence itself) until the auth logout commits,
      // so a failed logout keeps both the saved device cart and the
      // revocation fence for the still-signed-in customer.
      if (!deferCacheErasure) {
        let erased = true;
        if (
          isCartDeviceRevocationPending(merchantSlug) &&
          typeof window !== 'undefined'
        ) {
          erased = eraseRetiredCartCache(merchantSlug, retiringUserId);
          if (erased) clearSharedCartImportReceipt(merchantSlug);
        }
        // Keep the retirement fence until the cache is actually gone;
        // a later ensure pass retries the erasure.
        if (erased) {
          clearCartDeviceRevocationPending(merchantSlug);
          clearCartDeviceSessionActive(merchantSlug);
        }
      }
    }
    return { ok };
  } catch {
    return { ok: false };
  }
}

/**
 * Ensures any pending device-session revocation from an expired or
 * switched customer session completes before shared-cart reads or
 * bootstrap can adopt the surviving HTTP-only proof.
 */
export async function ensureCartDeviceRevocationCleared(
  merchantSlug?: string | null,
  signal?: AbortSignal
): Promise<boolean> {
  if (isCartSessionRetiring(merchantSlug)) return false;
  // A deferred logout owns the pending revocation until the auth
  // logout commits or is abandoned; clearing here would erase the
  // still-signed-in customer's parked cache on a transient failure.
  if (isDeferredCartLogout(merchantSlug)) return false;
  if (!isCartDeviceRevocationPending(merchantSlug)) return true;
  const revoked = await revokeCartDeviceSession(merchantSlug, { signal });
  return revoked.ok && !isCartDeviceRevocationPending(merchantSlug);
}

export function retireDeEnrolledCartDeviceSession(
  merchantSlug: string | null | undefined,
  options: { hasCartId: boolean; hasImportReceipt: boolean }
): void {
  if (!merchantSlug) return;
  if (
    options.hasCartId ||
    options.hasImportReceipt ||
    hasActiveCartDeviceSession(merchantSlug) ||
    isCartDeviceRevocationPending(merchantSlug)
  ) {
    void revokeCartDeviceSession(merchantSlug, {
      fenceOnFailure: false,
      drainActiveWrites: true,
    });
  }
}
