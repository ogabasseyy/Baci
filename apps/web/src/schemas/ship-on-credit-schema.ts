import { z } from 'zod';

export const shipOnCreditBodySchema = z.object({
  credit_notes: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
});
