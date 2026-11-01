import { z } from 'zod';
import { oxygenActivationReferenceSchema } from '@/lib/payments/oxygen/activation-binding';
export const oxygenActivationTrialStateSchema = z
  .object({
    status: z.enum([
      'ready',
      'queued',
      'executing',
      'activated',
      'rejected',
      'indeterminate',
    ]),
    orderConfirmed: z.boolean().default(false),
    result: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export const oxygenActivationTrialBodySchema = z
  .object({
    reference: oxygenActivationReferenceSchema,
  })
  .strict();
