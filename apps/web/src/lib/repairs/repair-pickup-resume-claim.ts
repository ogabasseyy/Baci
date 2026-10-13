import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const claimSchema = z.object({
  customerEmail: z.string().email().max(320),
  issuedAt: z.number().int().positive(),
  merchantId: z.uuid(),
  repairId: z.uuid(),
});

export type RepairPickupResumeClaim = z.infer<typeof claimSchema>;

const RESUME_CLAIM_TTL_MS = 2 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function serialize(claim: RepairPickupResumeClaim): string {
  return [
    '1',
    claim.repairId,
    claim.merchantId,
    normalizeEmail(claim.customerEmail),
    String(claim.issuedAt),
  ].join('\n');
}

function signatureFor(claim: RepairPickupResumeClaim, secret: string): string {
  return createHmac('sha256', secret).update(serialize(claim)).digest('hex');
}

export const repairPickupResumeClaims = {
  create(value: RepairPickupResumeClaim, secret: string): string {
    if (!secret) {
      throw new Error('Repair pickup resume signing secret is unavailable');
    }
    const claim = claimSchema.parse({
      ...value,
      customerEmail: normalizeEmail(value.customerEmail),
    });
    const payload = Buffer.from(serialize(claim), 'utf8').toString('base64url');
    return `${payload}.${signatureFor(claim, secret)}`;
  },

  verify(token: unknown, secret: string): RepairPickupResumeClaim | null {
    if (!secret || typeof token !== 'string') return null;
    const separator = token.lastIndexOf('.');
    if (separator <= 0) return null;

    const payload = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    if (!/^[a-f0-9]{64}$/.test(signature)) return null;

    let serialized: string;
    try {
      serialized = Buffer.from(payload, 'base64url').toString('utf8');
    } catch {
      return null;
    }

    const [version, repairId, merchantId, customerEmail, issuedAtRaw] =
      serialized.split('\n');
    if (version !== '1') return null;

    const issuedAt = Number(issuedAtRaw);
    const parsed = claimSchema.safeParse({
      customerEmail,
      issuedAt,
      merchantId,
      repairId,
    });
    if (!parsed.success) return null;

    if (Date.now() - parsed.data.issuedAt > RESUME_CLAIM_TTL_MS) {
      return null;
    }

    const expected = Buffer.from(signatureFor(parsed.data, secret), 'hex');
    const received = Buffer.from(signature, 'hex');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      return null;
    }

    return parsed.data;
  },
};
