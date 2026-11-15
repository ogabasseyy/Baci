const CUSTOMER_SESSION_HINT_COOKIE = 'baci_customer_session_hint';
const CUSTOMER_SESSION_HINT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type CustomerSessionHint = '1' | '0' | null;

export function getCustomerSessionHintScopePath(merchantSlug: string): string {
  if (typeof window === 'undefined' || !merchantSlug) {
    return '/';
  }

  const pathname = window.location.pathname;
  if (
    pathname === `/${merchantSlug}` ||
    pathname.startsWith(`/${merchantSlug}/`)
  ) {
    return `/${merchantSlug}`;
  }

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
  const secureAttribute =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? '; Secure'
      : '';

  if (value === null) {
    document.cookie = `${CUSTOMER_SESSION_HINT_COOKIE}=; Path=${path}; Max-Age=0; SameSite=Lax${secureAttribute}`;
    return;
  }

  document.cookie = `${CUSTOMER_SESSION_HINT_COOKIE}=${value}; Path=${path}; Max-Age=${CUSTOMER_SESSION_HINT_MAX_AGE_SECONDS}; SameSite=Lax${secureAttribute}`;
}

export function resetCustomerSessionHintForTests(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const secureAttribute =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? '; Secure'
      : '';
  document.cookie = `${CUSTOMER_SESSION_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secureAttribute}`;
}
