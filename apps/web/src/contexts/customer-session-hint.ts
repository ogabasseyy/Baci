const CUSTOMER_SESSION_HINT_COOKIE = 'baci_customer_session_hint';
const CUSTOMER_SESSION_HINT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const CUSTOMER_GUEST_HINT_MAX_AGE_SECONDS = 60 * 60;
const trackedHintPaths = new Set<string>(['/']);

export type CustomerSessionHint = '1' | '0' | null;

export function getCustomerSessionHintScopePath(_merchantSlug: string): string {
  // Supabase auth cookies are host-wide (Path=/), so the session hint must share
  // Path=/ across path-routed storefronts on the same host.
  return '/';
}

export function readCustomerSessionHint(): CustomerSessionHint {
  if (typeof document === 'undefined') {
    return null;
  }

  const entries = document.cookie ? document.cookie.split(';') : [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed.startsWith(`${CUSTOMER_SESSION_HINT_COOKIE}=`)) {
      continue;
    }

    const value = trimmed.slice(CUSTOMER_SESSION_HINT_COOKIE.length + 1);
    if (value === '1' || value === '0') {
      return value;
    }
    return null;
  }

  return null;
}

export function writeCustomerSessionHint(
  merchantSlug: string,
  value: CustomerSessionHint
): void {
  if (typeof document === 'undefined') {
    return;
  }

  const path = getCustomerSessionHintScopePath(merchantSlug);
  trackedHintPaths.add(path);
  const secureAttribute =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? '; Secure'
      : '';

  if (value === null) {
    document.cookie = `${CUSTOMER_SESSION_HINT_COOKIE}=; Path=${path}; Max-Age=0; SameSite=Lax${secureAttribute}`;
    return;
  }

  const maxAgeSeconds =
    value === '0'
      ? CUSTOMER_GUEST_HINT_MAX_AGE_SECONDS
      : CUSTOMER_SESSION_HINT_MAX_AGE_SECONDS;
  document.cookie = `${CUSTOMER_SESSION_HINT_COOKIE}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; SameSite=Lax${secureAttribute}`;
}

export function resetCustomerSessionHintForTests(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const secureAttribute =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? '; Secure'
      : '';
  for (const path of trackedHintPaths) {
    document.cookie = `${CUSTOMER_SESSION_HINT_COOKIE}=; Path=${path}; Max-Age=0; SameSite=Lax${secureAttribute}`;
  }
  trackedHintPaths.clear();
  trackedHintPaths.add('/');
}
