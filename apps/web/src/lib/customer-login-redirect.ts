/**
 * Redirect URL Utilities
 *
 * 2026 Best Practices:
 * - Security-first validation
 * - Prevent open redirect vulnerabilities
 */

const DEFAULT_REDIRECT = '/account';

/**
 * Validate and sanitize redirect URL to prevent open redirect vulnerabilities
 *
 * @param redirect - The redirect URL from query params
 * @returns A safe redirect URL
 */
export function sanitizeRedirect(redirect: string | null): string {
  if (!redirect) return DEFAULT_REDIRECT;

  // Block absolute URLs, protocol-relative URLs, and URLs with colons
  if (
    !redirect.startsWith('/') ||
    redirect.startsWith('//') ||
    /^\/(?:%2f|%5c|%25)/i.test(redirect) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(redirect.split(/[?#]/, 1)[0] ?? '') ||
    /[\\\p{Cc}]/u.test(redirect) ||
    redirect.includes(':')
  ) {
    return DEFAULT_REDIRECT;
  }

  return redirect;
}
