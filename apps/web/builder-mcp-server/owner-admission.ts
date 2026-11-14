import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify the exact signed wire body before reserving a long-lived work slot. */
export function createOwnerAdmission(
  key: Uint8Array,
  domain: string,
  now = Date.now
) {
  if (key.length !== 32) throw Error('INVALID_OWNER_ADMISSION_KEY');
  const secret = Uint8Array.from(key);
  // This is a per-process early filter, not a replacement for durable replay checks.
  const seen = new Map<string, number>();
  return (body: Uint8Array, signature: string): boolean => {
    if (!/^[a-f0-9]{64}$/.test(signature)) return false;
    try {
      const payload: unknown = JSON.parse(Buffer.from(body).toString('utf8'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return false;
      const expiresAt = (payload as { expiresAt?: unknown }).expiresAt;
      const nonce = (payload as { nonce?: unknown }).nonce;
      const current = now();
      if (
        typeof expiresAt !== 'number' ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= current ||
        expiresAt > current + 60000 ||
        typeof nonce !== 'string' ||
        !/^[a-f0-9]{64}$/.test(nonce)
      )
        return false;
      const expected = createHmac('sha256', secret)
        .update(`${domain}\n`)
        .update(body)
        .digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
        return false;
      for (const [seenNonce, expiry] of seen)
        if (expiry <= current) seen.delete(seenNonce);
      if (seen.has(nonce) || seen.size >= 4096) return false;
      seen.set(nonce, expiresAt);
      return true;
    } catch {
      return false;
    }
  };
}
