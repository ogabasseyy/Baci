const PENDING_REVOCATION_KEY_PREFIX = 'baci-cart-revocation-pending';
const ACTIVE_SESSION_KEY_PREFIX = 'baci-cart-device-session-active';
const pendingRevocationMerchants = new Set<string>();
const volatilePendingMerchants = new Set<string>();

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
    volatilePendingMerchants.delete(key);
  } catch {
    volatilePendingMerchants.add(key);
    // Failed durable writes must retain their in-memory fence.
  }
}

export function clearCartDeviceRevocationPending(
  merchantSlug?: string | null
): void {
  const key = normalizeMerchantKey(merchantSlug);
  pendingRevocationMerchants.delete(key);
  volatilePendingMerchants.delete(key);
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
  if (typeof window === 'undefined') return pendingRevocationMerchants.has(key);
  try {
    const stored =
      window.localStorage.getItem(
        getPendingRevocationStorageKey(merchantSlug)
      ) === '1';
    if (stored) pendingRevocationMerchants.add(key);
    else if (!volatilePendingMerchants.has(key))
      pendingRevocationMerchants.delete(key);
    // A successful durable clear in another tab supersedes this realm's
    // old marker. Failed writes remain fenced even if a read now succeeds.
    return stored || volatilePendingMerchants.has(key);
  } catch {
    return pendingRevocationMerchants.has(key);
  }
}

export function resetPendingCartDeviceRevocationsForTests(): void {
  pendingRevocationMerchants.clear();
  volatilePendingMerchants.clear();
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
