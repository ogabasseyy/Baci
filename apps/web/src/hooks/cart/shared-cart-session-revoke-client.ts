import { fetchWithCsrf } from '@/lib/api-client';
import { withCartRequestDeadline } from './cart-request-deadline';
import { isCartSessionRetiring } from './cart-session-write-fence';
import {
  clearSharedCartImportReceipt,
  getStorefrontCartStorageKey,
} from './cart-storage';

const PENDING_REVOCATION_KEY_PREFIX = 'baci-cart-revocation-pending';
const ACTIVE_SESSION_KEY_PREFIX = 'baci-cart-device-session-active';
const pendingRevocationMerchants = new Set<string>();

function normalizeMerchantKey(merchantSlug?: string | null): string {
  return merchantSlug?.trim() || '__default__';
}

function getPendingRevocationStorageKey(merchantSlug?: string | null): string {
  return `${PENDING_REVOCATION_KEY_PREFIX}:${normalizeMerchantKey(merchantSlug)}`;
}

function getActiveSessionStorageKey(merchantSlug?: string | null): string {
  return `${ACTIVE_SESSION_KEY_PREFIX}:${normalizeMerchantKey(merchantSlug)}`;
}

export function markCartDeviceSessionActive(
  merchantSlug?: string | null
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getActiveSessionStorageKey(merchantSlug), '1');
  } catch {
    // Ignore storage errors in restricted frames.
  }
}

export function clearCartDeviceSessionActive(
  merchantSlug?: string | null
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getActiveSessionStorageKey(merchantSlug));
  } catch {
    // Ignore storage errors in restricted frames.
  }
}

export function hasActiveCartDeviceSession(
  merchantSlug?: string | null
): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.localStorage.getItem(getActiveSessionStorageKey(merchantSlug)) ===
      '1'
    );
  } catch {
    return false;
  }
}

export function markCartDeviceRevocationPending(
  merchantSlug?: string | null
): void {
  const key = normalizeMerchantKey(merchantSlug);
  pendingRevocationMerchants.add(key);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      getPendingRevocationStorageKey(merchantSlug),
      '1'
    );
  } catch {
    // Ignore storage errors; the in-memory fence still blocks adoption in this tab.
  }
}

export function clearCartDeviceRevocationPending(
  merchantSlug?: string | null
): void {
  const key = normalizeMerchantKey(merchantSlug);
  pendingRevocationMerchants.delete(key);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(
      getPendingRevocationStorageKey(merchantSlug)
    );
  } catch {
    // Ignore storage errors in restricted frames.
  }
}

export function isCartDeviceRevocationPending(
  merchantSlug?: string | null
): boolean {
  const key = normalizeMerchantKey(merchantSlug);
  if (pendingRevocationMerchants.has(key)) return true;
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.localStorage.getItem(
        getPendingRevocationStorageKey(merchantSlug)
      ) === '1'
    );
  } catch {
    return false;
  }
}

export function resetPendingCartDeviceRevocationsForTests(): void {
  pendingRevocationMerchants.clear();
  if (typeof window === 'undefined') return;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (
        key.startsWith(`${PENDING_REVOCATION_KEY_PREFIX}:`) ||
        key.startsWith(`${ACTIVE_SESSION_KEY_PREFIX}:`)
      ) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage cleanup errors in tests.
  }
}

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
  options?: { fenceOnFailure?: boolean; signal?: AbortSignal }
): Promise<{ ok: boolean }> {
  const result = await withCartRequestDeadline(
    { ok: false },
    (signal) => requestDeviceRevocation(merchantSlug, signal),
    options?.signal
  );
  if (!result.ok && options?.fenceOnFailure !== false)
    markCartDeviceRevocationPending(merchantSlug);
  return result;
}
async function requestDeviceRevocation(
  merchantSlug: string | null | undefined,
  signal: AbortSignal
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
      // read this key directly after passive revocation succeeds.
      if (
        isCartDeviceRevocationPending(merchantSlug) &&
        typeof window !== 'undefined'
      ) {
        window.localStorage.removeItem(
          getStorefrontCartStorageKey(merchantSlug)
        );
        clearSharedCartImportReceipt(merchantSlug);
      }
      clearCartDeviceRevocationPending(merchantSlug);
      clearCartDeviceSessionActive(merchantSlug);
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
  if (!isCartDeviceRevocationPending(merchantSlug)) return true;
  const revoked = await revokeCartDeviceSession(merchantSlug, { signal });
  if (revoked.ok) {
    clearCartDeviceRevocationPending(merchantSlug);
    return true;
  }
  return false;
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
    void revokeCartDeviceSession(merchantSlug, { fenceOnFailure: false });
  }
}
