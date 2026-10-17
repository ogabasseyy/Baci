// Client-side CSRF token helpers
// Safe to import in browser bundles without pulling next/server or next/headers

const IS_PROD = process.env.NODE_ENV === 'production';
export const PRIMARY_CSRF_TOKEN_NAME = IS_PROD
  ? '__Host-csrf-token'
  : 'csrf-token';
export const FALLBACK_CSRF_TOKEN_NAME = IS_PROD
  ? 'csrf-token'
  : '__Host-csrf-token';
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const CSRF_TOKEN_NAMES = [
  PRIMARY_CSRF_TOKEN_NAME,
  FALLBACK_CSRF_TOKEN_NAME,
];

/**
 * Client-side helper to get CSRF token from cookie
 */
export function getClientCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;

  const cookies = document.cookie.split(';');
  for (const name of CSRF_TOKEN_NAMES) {
    const csrfCookie = cookies.find((c) => c.trim().startsWith(`${name}=`));
    if (csrfCookie) {
      return csrfCookie.split('=').slice(1).join('=');
    }
  }
  return null;
}

/**
 * Build headers with CSRF token for client-side fetch calls.
 * Merges provided extra headers with the x-csrf-token header.
 */
export function buildCsrfHeaders(
  extraHeaders?: HeadersInit
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (extraHeaders) {
    if (extraHeaders instanceof Headers) {
      extraHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(extraHeaders)) {
      for (const [key, value] of extraHeaders) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, extraHeaders);
    }
  }

  const csrfToken = getClientCsrfToken();
  const hasCsrfHeader = Object.keys(headers).some(
    (key) => key.toLowerCase() === CSRF_HEADER_NAME
  );

  if (csrfToken && !hasCsrfHeader) {
    headers[CSRF_HEADER_NAME] = csrfToken;
  } else if (!hasCsrfHeader && typeof document !== 'undefined') {
    console.warn(
      `[CSRF] Missing ${CSRF_HEADER_NAME} cookie. State-changing requests may be rejected with 403. Refresh the page to obtain a new token.`
    );
  }

  return headers;
}
