import { z } from 'zod';

export const checkoutProxyConfigSchema = z.strictObject({
  version: z.literal(3),
  routes: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
});
