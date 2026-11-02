import 'server-only';

import { GIGL_WEBHOOK_MAX_ENCRYPTED_CHARS } from './gigl-webhook-limits';
import { GIGL_WEBHOOK_BASE64_PATTERN } from './gigl-webhook-patterns';

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
    !GIGL_WEBHOOK_BASE64_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}
