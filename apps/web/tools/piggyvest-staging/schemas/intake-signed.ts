import { z } from 'zod';
import { intakeSchema } from '../intake-schema';

export const signedIntakeSchemas = {
  sealed: intakeSchema.extend({
    originalSignature: z.string().length(128).regex(/^[a-f0-9]+$/i),
  }),
  receipt: z.strictObject({
    receiptId: z.uuid(),
    duplicate: z.boolean(),
    durable: z.literal(true),
    signatureStored: z.literal(true),
  }),
};
