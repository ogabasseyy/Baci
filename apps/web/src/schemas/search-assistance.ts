import { searchAssistanceQuerySchema } from '@baci/shared/lib';
import { z } from 'zod';
export const searchAssistanceRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    query: searchAssistanceQuerySchema,
  })
  .strict();
