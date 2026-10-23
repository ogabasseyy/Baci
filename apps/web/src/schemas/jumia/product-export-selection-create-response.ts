import { z } from 'zod';

export const jumiaProductExportSelectionCreateResponseSchema = z
  .object({
    selectionId: z.uuid(),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .passthrough();
