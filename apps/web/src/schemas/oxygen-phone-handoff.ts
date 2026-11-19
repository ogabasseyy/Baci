import { z } from 'zod';

export const oxygenPhoneCapabilitySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/);
export const oxygenPhoneRedemptionSchema = z
  .object({
    token: oxygenPhoneCapabilitySchema,
    selfieOrigins: z.array(z.string().url().max(255)).max(100),
  })
  .strict();
export const oxygenPhoneStoredSchema = z
  .object({
    workflowId: z.uuid(),
    applicationReference: z.uuid(),
    environment: z.enum(['staging', 'production']),
    ciphertext: z.string().min(1).max(24000),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const oxygenPhoneTargetSchema = z
  .object({ url: z.string().url().max(16000) })
  .strict();
