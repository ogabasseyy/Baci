import { z } from 'zod';

export const brilStashFeedDeploymentSchema = z.strictObject({
  host: z
    .string()
    .regex(/^[a-z0-9.-]+$/)
    .min(1),
  environment: z.enum(['live', 'sandbox']),
  projectRef: z.string().regex(/^[a-z0-9]+$/),
});
