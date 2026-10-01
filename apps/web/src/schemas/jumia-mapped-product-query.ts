import { z } from 'zod';

export const jumiaMappedProductQuerySchema = z.object({
  integrationId: z.uuid(),
});
