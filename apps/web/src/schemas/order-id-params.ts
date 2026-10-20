import { z } from 'zod';

export const orderIdParamsSchema = z.object({
  id: z.uuid(),
});
