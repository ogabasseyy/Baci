import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify the exact signed wire body before reserving a long-lived work slot. */
export function createOwnerAdmission(
  key: Uint8Array,
  domain: string,
  now = Date.now
) {
  if (key.length !== 32) throw Error('INVALID_OWNER_ADMISSION_KEY');
  const secret = Uint8Array.from(key);
  return (body: Uint8Array, signature: string): boolean => {
    if (!/^[a-f0-9]{64}$/.test(signature)) return false;
    try {
      const payload: unknown = JSON.parse(Buffer.from(body).toString('utf8'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return false;
      const expiresAt = (payload as { expiresAt?: unknown }).expiresAt;
      const current = now();
      if (
        typeof expiresAt !== 'number' ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= current ||
        expiresAt > current + 60000
      )
        return false;
      const expected = createHmac('sha256', secret)
        .update(`${domain}\n`)
        .update(body)
        .digest();
      return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  };
}
