import { z } from 'zod';

export const createJumiaProductExportSelectionSchema = z
  .object({
    sourceCategoryId: z.uuid(),
  })
  .strict();

export const jumiaProductExportSelectionRpcRowSchema = z
  .object({
    selection_id: z.uuid(),
    total: z.number().int().min(0),
    captured_at: z.string().min(1),
    expires_at: z.string().min(1),
  })
  .strict();

export const jumiaProductExportEligibleQuerySchema = z
  .object({
    selectionId: z.uuid(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
