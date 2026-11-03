import { z } from 'zod';
export const experiencePreviewInput = z.strictObject({
  merchantId: z.uuid(),
  buildId: z.uuid(),
  routeId: z.string().min(1).max(240),
});
