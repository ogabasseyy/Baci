import { z } from 'zod';
export const experiencePreviewInput = z.strictObject({
  merchantId: z.uuid(),
  buildId: z.uuid(),
  routeId: z.string().min(1).max(240).optional(),
});

export const experiencePreviewStatusInput = z.object({
  merchantId: z.uuid(),
  bindingId: z.uuid(),
});

export const experiencePreviewPageInput = z.object({
  merchant: z.uuid(),
  build: z.uuid(),
  routeId: z.string().min(1).max(240).optional(),
});
