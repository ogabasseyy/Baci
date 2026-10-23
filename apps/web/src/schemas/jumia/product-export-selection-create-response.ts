import { z } from 'zod';

export const jumiaProductExportSelectionCreateResponseSchema = z
  .object({
    selectionId: z.string().uuid(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .passthrough();
