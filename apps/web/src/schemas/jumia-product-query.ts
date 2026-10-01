import { z } from 'zod';

export const jumiaProductQuerySchema = z.object({
  productId: z.uuid(),
  integrationId: z.uuid(),
});
