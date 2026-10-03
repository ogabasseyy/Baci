import { z } from 'zod';
export const searchAssistanceRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    query: z.string().trim().min(2).max(120),
  })
  .strict();
