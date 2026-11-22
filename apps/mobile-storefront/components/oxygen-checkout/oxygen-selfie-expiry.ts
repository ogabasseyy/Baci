import { decodeBase64UrlToUtf8 } from '@/lib/cart/base64url';

/** Unverified expiry is a UI recovery hint only, never an identity/auth verdict. */
export function oxygenSelfieExpiresAt(url?: string): number | null {
  try {
    if (!url || url.length > 32768) return null;
    const token = new URL(url).searchParams.get('securityToken');
    const parts = token?.split('.');
    if (parts?.length !== 3 || parts[1].length > 8192) return null;
    const payload: unknown = JSON.parse(decodeBase64UrlToUtf8(parts[1]));
    if (!payload || typeof payload !== 'object' || !('exp' in payload))
      return null;
    const exp = payload.exp;
    return typeof exp === 'number' &&
      Number.isSafeInteger(exp) &&
      exp > 0 &&
      Number.isSafeInteger(exp * 1000)
      ? exp * 1000
      : null;
  } catch {
    return null;
  }
}
