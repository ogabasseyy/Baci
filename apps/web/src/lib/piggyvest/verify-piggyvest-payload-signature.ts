import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Money-flow verifier. Per the provider contract (17 Sep 2026) the HMAC
 * covers the exact raw request bytes: hex(HMAC-SHA512(secret, raw_body)),
 * delivered in `x-pvb-signature`. This supersedes the docs-page sample,
 * which re-serialized the parsed body. Callers must pass the untouched
 * wire bytes; re-serialization (whitespace/key-order drift) would reject
 * everything the provider actually signs.
 */
export function verifyPiggyvestPayloadSignature({
  payload,
  signature,
  secret,
}: {
  payload: Uint8Array;
  signature: string | null;
  secret: string | undefined;
}): boolean {
  if (!secret?.trim() || !signature || !/^[a-f0-9]{128}$/.test(signature)) {
    return false;
  }

  const expected = createHmac('sha512', secret).update(payload).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
