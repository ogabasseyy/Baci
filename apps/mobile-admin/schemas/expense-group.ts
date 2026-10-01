import { z } from 'zod';

export const ExpenseGroupSchema = z
  .object({
    id: z.uuid(),
    merchant_id: z.uuid(),
    name: z.string().min(1).max(80),
    archived_at: z.iso.datetime({ offset: true }).nullable(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ExpenseGroup = z.infer<typeof ExpenseGroupSchema>;
export const ExpenseGroupIdSchema = z.uuid();
export const ExpenseGroupNameSchema = z.string().trim().min(1).max(80);
