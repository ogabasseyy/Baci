const DEFERRED_LOGOUT_KEY_PREFIX = 'baci-cart-logout-deferred';
// A deferred logout is bounded by the retirement drain, the revocation
// deadline, and the 15s auth-logout request, so a marker older than
// this lease can only be an orphan from a closed or reloaded page.
export const DEFERRED_LOGOUT_LEASE_MS = 120_000;
const deferredLogoutMerchants = new Set<string>();

function normalizeMerchantKey(merchantSlug?: string | null): string {
  return merchantSlug?.trim() || '__default__';
}

function getDeferredLogoutStorageKey(merchantSlug?: string | null): string {
  return `${DEFERRED_LOGOUT_KEY_PREFIX}:${normalizeMerchantKey(merchantSlug)}`;
}

/** Mark a logout whose cache erasure is deferred until the auth logout commits. */
export function beginDeferredCartLogout(merchantSlug?: string | null): void {
  deferredLogoutMerchants.add(normalizeMerchantKey(merchantSlug));
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      getDeferredLogoutStorageKey(merchantSlug),
      String(Date.now())
    );
  } catch {
    // The in-memory marker still fences this tab.
  }
}

/** End a deferred logout after its committed cleanup ran. */
export function endDeferredCartLogout(merchantSlug?: string | null): void {
  deferredLogoutMerchants.delete(normalizeMerchantKey(merchantSlug));
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getDeferredLogoutStorageKey(merchantSlug));
  } catch {
    // Ignore storage errors in restricted frames.
  }
}

export function isDeferredCartLogout(merchantSlug?: string | null): boolean {
  if (deferredLogoutMerchants.has(normalizeMerchantKey(merchantSlug)))
    return true;
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(
      getDeferredLogoutStorageKey(merchantSlug)
    );
    if (raw === null) return false;
    const startedAt = Number(raw);
    // Pre-lease markers ('1') carry no start time and can only have
    // been orphaned by an older page life; a live logout rewrites the
    // marker with a timestamp when it begins.
    if (!Number.isFinite(startedAt) || startedAt <= 0) {
      endDeferredCartLogout(merchantSlug);
      return false;
    }
    if (Date.now() - startedAt > DEFERRED_LOGOUT_LEASE_MS) {
      endDeferredCartLogout(merchantSlug);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop a persisted deferred-logout marker that no live tab owns, so a
 * reload or close mid-logout cannot fence provisioning forever. Live
 * markers inside their lease are left for their owner to finish.
 */
export function reconcileOrphanedDeferredCartLogout(
  merchantSlug?: string | null
): boolean {
  if (deferredLogoutMerchants.has(normalizeMerchantKey(merchantSlug)))
    return false;
  if (typeof window === 'undefined') return false;
  try {
    const hadMarker =
      window.localStorage.getItem(getDeferredLogoutStorageKey(merchantSlug)) !==
      null;
    if (!hadMarker) return false;
    // Still inside its lease: a live logout in another tab owns it.
    if (isDeferredCartLogout(merchantSlug)) return false;
    // isDeferredCartLogout already cleared the expired/legacy marker.
    return true;
  } catch {
    return false;
  }
}
