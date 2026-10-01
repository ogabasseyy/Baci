import { constantTimeEqual } from '@/lib/constant-time-equal';

/**
 * Juicyway Webhook Signature Verification
 * Uses HMAC SHA-256 via Web Crypto API
 */

/**
 * Verify webhook signature using HMAC SHA-256 (Web Crypto API)
 */
export async function verifyWebhookSignature(
  event: string,
  data: Record<string, unknown>,
  checksum: string,
  businessId: string
): Promise<boolean> {
  // Business IDs are identifiers; deployment whitespace is not part of the key.
  const normalizedBusinessId = businessId.trim();
  if (!normalizedBusinessId) return false;

  // Sort data alphabetically and stringify
  const sortedData = Object.keys(data)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = data[key];
      return acc;
    }, {});

  const message = `${event}|${JSON.stringify(sortedData)}`;
  const encoder = new TextEncoder();

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(normalizedBusinessId),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(message)
  );

  const computedChecksum = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison to prevent timing attacks
  return (
    !(!computedChecksum || !checksum) &&
    constantTimeEqual(computedChecksum.toLowerCase(), checksum.toLowerCase())
  );
}
