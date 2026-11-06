import { z } from 'zod';

export const chatDeliveryEstimateRequestSchema = z
  .object({ state: z.string().trim().min(2).max(100) })
  .strict();
