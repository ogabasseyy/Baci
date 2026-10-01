import 'server-only';

const HEX_KEY = /^[0-9a-f]{64}$/i;
const BASE64URL_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * Ads token encryption keys are either 32-byte hex or canonical base64url.
 * Validate the encoded value before OAuth state is reserved or consent starts.
 */
export function isValidAdsTokenEncryptionKey(value: string): boolean {
  const trimmed = value.trim();
  if (HEX_KEY.test(trimmed)) return true;
  if (!BASE64URL_KEY.test(trimmed)) return false;
  try {
    const decoded = Buffer.from(trimmed, 'base64url');
    return decoded.length === 32 && decoded.toString('base64url') === trimmed;
  } catch {
    return false;
  }
}
