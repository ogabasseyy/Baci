import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const inputSchema = z.object({
  amountKobo: z.number().int().positive(),
  currency: z.string().length(3),
  merchantId: z.uuid(),
  reference: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  repairId: z.uuid(),
});

const metadataSchema = z.object({
  currency: z.string().length(3),
  merchant_id: z.uuid(),
  pickup_amount_kobo: z.number().int().positive(),
  pickup_claim_signature: z.string().regex(/^[a-f0-9]{64}$/),
  pickup_claim_version: z.literal(1),
  reference: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  repair_id: z.uuid(),
  transaction_type: z.literal('repair_pickup'),
});

export type RepairPickupPaymentClaimInput = z.infer<typeof inputSchema>;
export type RepairPickupPaymentClaimMetadata = z.infer<typeof metadataSchema>;

function serialize(input: RepairPickupPaymentClaimInput): string {
  return [
    '1',
    input.reference,
    input.repairId,
    input.merchantId,
    String(input.amountKobo),
    input.currency.toUpperCase(),
  ].join('\n');
}

function signatureFor(
  input: RepairPickupPaymentClaimInput,
  secret: string
): string {
  return createHmac('sha256', secret).update(serialize(input)).digest('hex');
}

export const repairPickupPaymentClaims = {
  create(
    value: RepairPickupPaymentClaimInput,
    secret: string
  ): RepairPickupPaymentClaimMetadata {
    if (!secret) {
      throw new Error('Repair pickup payment signing secret is unavailable');
    }
    const input = inputSchema.parse({
      ...value,
      currency: value.currency.toUpperCase(),
    });
    return {
      currency: input.currency,
      merchant_id: input.merchantId,
      pickup_amount_kobo: input.amountKobo,
      pickup_claim_signature: signatureFor(input, secret),
      pickup_claim_version: 1,
      reference: input.reference,
      repair_id: input.repairId,
      transaction_type: 'repair_pickup',
    };
  },

  verify(value: unknown, secret: string): RepairPickupPaymentClaimInput | null {
    if (!secret) return null;
    const parsed = metadataSchema.safeParse(value);
    if (!parsed.success) return null;

    const input = {
      amountKobo: parsed.data.pickup_amount_kobo,
      currency: parsed.data.currency.toUpperCase(),
      merchantId: parsed.data.merchant_id,
      reference: parsed.data.reference,
      repairId: parsed.data.repair_id,
    };
    const expected = Buffer.from(signatureFor(input, secret), 'hex');
    const received = Buffer.from(parsed.data.pickup_claim_signature, 'hex');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      return null;
    }
    return input;
  },
};
