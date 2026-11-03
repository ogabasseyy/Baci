import { z } from 'zod';

export const redvaultUncertainAttemptSchema = z.object({
  version: z.literal(1),
  merchantId: z.uuid(),
  idempotencyKey: z.string().min(1).max(128),
  fingerprint: z.string().startsWith('uba_redvault:').max(50_000),
  customer: z.object({
    email: z.email(),
    name: z.string().min(1),
    phone: z.string().min(1),
  }),
  billingAddress: z.object({
    line1: z.string().min(1),
    city: z.string().min(1),
    state: z.string().optional(),
    country: z.string().length(2),
    zip_code: z.string().optional(),
  }),
  orderRequest: z.unknown(),
  createdAt: z.number().int().positive(),
});
