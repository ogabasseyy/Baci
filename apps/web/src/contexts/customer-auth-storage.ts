import { resetPendingCartDeviceRevocationsForTests } from '@/hooks/cart/shared-cart-session-revoke-client';
import { getLiveCustomerIdentity } from './customer-live-identity';

const CUSTOMER_AUTH_USER_KEY_PREFIX = 'baci-customer-auth-user';
const CUSTOMER_AUTH_ROLLBACK_KEY_PREFIX = 'baci-customer-auth-rollback';
const rememberedCustomerUserByMerchant = new Map<string, string>();
const pendingCustomerRollbackByMerchant = new Set<string>();

function getCustomerAuthUserStorageKey(merchantSlug: string): string {
  return `${CUSTOMER_AUTH_USER_KEY_PREFIX}-${merchantSlug}`;
}

function getCustomerAuthRollbackStorageKey(merchantSlug: string): string {
  return `${CUSTOMER_AUTH_ROLLBACK_KEY_PREFIX}-${merchantSlug}`;
}

export function getRememberedCustomerUserId(
  merchantSlug: string,
  currentUserId?: string | null
): string | null {
  if (currentUserId) return currentUserId;
  const live = getLiveCustomerIdentity();
  if (live.merchantSlug === merchantSlug && live.userId) return live.userId;
  const inMemory = rememberedCustomerUserByMerchant.get(merchantSlug);
  if (inMemory) return inMemory;
  if (typeof window === 'undefined') return null;
  try {
    return (
      window.localStorage.getItem(
        getCustomerAuthUserStorageKey(merchantSlug)
      ) || null
    );
  } catch {
    return null;
  }
}

export function setRememberedCustomerUserId(
  merchantSlug: string,
  userId: string | null
): void {
  if (userId) {
    rememberedCustomerUserByMerchant.set(merchantSlug, userId);
  } else {
    rememberedCustomerUserByMerchant.delete(merchantSlug);
  }
  if (typeof window === 'undefined') return;
  try {
    const key = getCustomerAuthUserStorageKey(merchantSlug);
    if (userId) {
      window.localStorage.setItem(key, userId);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access errors in private browsing or restricted frames.
  }
}

export function isCustomerAuthRollbackPending(merchantSlug: string): boolean {
  if (pendingCustomerRollbackByMerchant.has(merchantSlug)) return true;
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.localStorage.getItem(
        getCustomerAuthRollbackStorageKey(merchantSlug)
      ) === '1'
    );
  } catch {
    return false;
  }
}

export function markCustomerAuthRollbackPending(merchantSlug: string): void {
  pendingCustomerRollbackByMerchant.add(merchantSlug);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      getCustomerAuthRollbackStorageKey(merchantSlug),
      '1'
    );
  } catch {
    // Ignore storage access errors in private browsing or restricted frames.
  }
}

export function clearCustomerAuthRollbackPending(merchantSlug: string): void {
  pendingCustomerRollbackByMerchant.delete(merchantSlug);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(
      getCustomerAuthRollbackStorageKey(merchantSlug)
    );
  } catch {
    // Ignore storage access errors in private browsing or restricted frames.
  }
}

export async function rollbackCustomerAuthSession(
  merchantSlug: string
): Promise<boolean> {
  markCustomerAuthRollbackPending(merchantSlug);
  try {
    const response = await fetch('/api/storefront/auth/logout', {
      method: 'POST',
    });
    if (!response.ok) {
      console.error(
        `Auth switch rollback failed with status ${response.status}`
      );
      return false;
    }
    clearCustomerAuthRollbackPending(merchantSlug);
    return true;
  } catch (error) {
    console.error('Auth switch rollback error:', error);
    return false;
  }
}

export function resetRememberedCustomerSessionsForTests(): void {
  rememberedCustomerUserByMerchant.clear();
  pendingCustomerRollbackByMerchant.clear();
  resetPendingCartDeviceRevocationsForTests?.();
  if (typeof window === 'undefined') return;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (
        key.startsWith(`${CUSTOMER_AUTH_USER_KEY_PREFIX}-`) ||
        key.startsWith(`${CUSTOMER_AUTH_ROLLBACK_KEY_PREFIX}-`)
      ) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage access errors in test cleanup.
  }
}
