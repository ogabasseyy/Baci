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
    result: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export const oxygenActivationTrialBodySchema = z
  .object({
    reference: z.literal('438f96ee-37c4-49bb-a56c-51451f9cb624'),
  })
  .strict();
