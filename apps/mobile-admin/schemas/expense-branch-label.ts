import { z } from 'zod';

export const ExpenseBranchLabelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .strict();

export type ExpenseBranchLabel = z.infer<typeof ExpenseBranchLabelSchema>;
