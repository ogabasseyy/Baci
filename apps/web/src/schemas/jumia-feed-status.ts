import { z } from 'zod';

export const jumiaFeedStatusQuerySchema = z.object({
  integrationId: z.uuid(),
});
