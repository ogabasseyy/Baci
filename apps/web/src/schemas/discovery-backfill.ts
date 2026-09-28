import { z } from 'zod';

export const discoveryBackfillSchema = z.strictObject({
  merchantId: z.uuid(),
  cursor: z.uuid().nullable(),
});
