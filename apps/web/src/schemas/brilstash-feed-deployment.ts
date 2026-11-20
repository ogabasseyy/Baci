import { z } from 'zod';

// Public HTTPS deployments use a bare DNS name with complete labels.
export const brilStashFeedHostSchema = z
  .string()
  .max(253)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
  );

export const brilStashFeedDeploymentSchema = z.strictObject({
  host: brilStashFeedHostSchema,
  environment: z.enum(['live', 'sandbox']),
  projectRef: z.string().regex(/^[a-z0-9]+$/),
});
