import { CART_SESSION_HINT_TTL_SECONDS } from '@/lib/cart/cart-session-hint-constants';
import { cartSessionHintCookieName } from '@/lib/cart/cart-session-hint-cookie-name';

const trackedHintNames = new Set<string>();

export type CartSessionHint = '1' | '0' | null;

/**
 * Reads the non-HttpOnly tri-state cart hint cookie for a specific merchant.
 * Returns `'1'` if a server cart session is expected, `'0'` if known empty,
 * or `null` if unknown/missing.
 */
export function readCartSessionHint(
  merchantId?: string | null
): CartSessionHint {
  if (typeof document === 'undefined' || !merchantId?.trim()) {
    return null;
  }

  const cookieName = cartSessionHintCookieName(merchantId);
  const entries = document.cookie ? document.cookie.split(';') : [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed.startsWith(`${cookieName}=`)) {
      continue;
    }

    const value = trimmed.slice(cookieName.length + 1);
    if (value === '1' || value === '0') {
      return value;
    }
    return null;
  }

  return null;
}

/**
 * Writes or clears the merchant-scoped cart hint cookie (`Path=/`, `SameSite=Lax`).
 * Isolated by merchant ID so switching stores on the same origin never leaks.
 */
export function writeCartSessionHint(
  merchantId: string | null | undefined,
  value: CartSessionHint
): void {
  if (typeof document === 'undefined' || !merchantId?.trim()) {
    return;
  }

  const cookieName = cartSessionHintCookieName(merchantId);
  trackedHintNames.add(cookieName);
  const secureAttribute =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? '; Secure'
      : '';

  if (value === null) {
    document.cookie = `${cookieName}=; Path=/; Max-Age=0; SameSite=Lax${secureAttribute}`;
    return;
  }

  const maxAgeSeconds =
    value === '0'
      ? CART_SESSION_HINT_TTL_SECONDS.empty
      : CART_SESSION_HINT_TTL_SECONDS.active;
  document.cookie = `${cookieName}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secureAttribute}`;
}

export function resetCartSessionHintForTests(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const secureAttribute =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? '; Secure'
      : '';
  for (const cookieName of trackedHintNames) {
    document.cookie = `${cookieName}=; Path=/; Max-Age=0; SameSite=Lax${secureAttribute}`;
  }
  trackedHintNames.clear();
}
