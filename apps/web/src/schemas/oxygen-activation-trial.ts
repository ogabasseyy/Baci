import { z } from 'zod';
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
    reference: z.uuid(),
  })
  .strict();
