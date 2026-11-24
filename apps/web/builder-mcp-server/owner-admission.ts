import { createHmac, timingSafeEqual } from 'node:crypto';
import { decodeJwt } from 'jose';
import {
  experienceOwnerSubject,
  experienceOwnerWireSchemas,
} from '../src/schemas/experience-owner-wire';

export type OwnerAdmission = (
  body: Uint8Array,
  signature: string,
  reserveOwner?: (ownerId: string) => boolean
) => boolean | 'busy';

/** Validate the signed operation with the same schema used by the downstream handler. */
export function createOwnerAdmission(
  key: Uint8Array,
  domain: keyof typeof experienceOwnerWireSchemas,
  now = Date.now
): OwnerAdmission {
  if (key.length !== 32) throw Error('INVALID_OWNER_ADMISSION_KEY');
  const secret = Uint8Array.from(key);
  // This is a per-process early filter, not a replacement for durable replay checks.
  const seen = new Map<string, number>();
  return (body, signature, reserveOwner) => {
    if (!/^[a-f0-9]{64}$/.test(signature)) return false;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
      const parsed = experienceOwnerWireSchemas[domain].safeParse(
        JSON.parse(text)
      );
      if (!parsed.success) return false;
      const { expiresAt, nonce } = parsed.data;
      const current = now();
      if (expiresAt <= current || expiresAt > current + 60000) return false;
      const expected = createHmac('sha256', secret)
        .update(`${domain}\n`)
        .update(JSON.stringify(parsed.data))
        .digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
        return false;
      for (const [seenNonce, expiry] of seen)
        if (expiry <= current) seen.delete(seenNonce);
      if (seen.has(nonce)) return false;
      if (seen.size >= 4096) return 'busy';
      if (reserveOwner) {
        // The trusted relay signs the entire token after verifying the user.
        // The subject is only a quota key; downstream still authenticates.
        const owner = experienceOwnerSubject.safeParse(
          decodeJwt(parsed.data.accessToken).sub
        );
        if (!owner.success) return false;
        if (!reserveOwner(owner.data.toLowerCase())) return 'busy';
      }
      seen.set(nonce, expiresAt);
      return true;
    } catch {
      return false;
    }
  };
}
