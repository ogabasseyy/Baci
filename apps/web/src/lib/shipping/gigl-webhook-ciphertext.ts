import 'server-only';

/** Largest encrypted payload accepted, in base64 characters. */
export const GIGL_WEBHOOK_MAX_ENCRYPTED_CHARS = 16_384;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * GIG documents the body as the bare base64 string. A .NET JSON serializer
 * would send the same string JSON-quoted, so both shapes are accepted; any
 * other shape yields null.
 */
export function extractGiglWebhookCiphertext(rawBody: string): string | null {
  let candidate = rawBody.trim();
  if (candidate.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed !== 'string') return null;
      candidate = parsed.trim();
    } catch {
      return null;
    }
  }
  if (
    candidate.length === 0 ||
    candidate.length > GIGL_WEBHOOK_MAX_ENCRYPTED_CHARS ||
    candidate.length % 4 !== 0 ||
    !BASE64_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}
