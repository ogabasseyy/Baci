import { z } from 'zod';

export const ExpenseSchema = z
  .object({
    id: z.string(),
    amount: z.number().finite().positive(),
    category: z.string(),
    description: z.string().nullable(),
    date: z.string(),
    merchant_id: z.string().uuid(),
    receipt_url: z.string().nullable(),
    branch_id: z.string().nullable(),
    group_id: z.string().nullable(),
    vendor_name: z.string().nullable(),
    payment_method: z.string().nullable(),
    reference: z.string().nullable(),
    receipt_storage_path: z.string().nullable(),
    created_by_user_id: z.string().nullable(),
    updated_by_user_id: z.string().nullable(),
    updated_at: z.string(),
  })
  .strict();

export type Expense = z.infer<typeof ExpenseSchema>;

const legacySpecialAmount = (value: unknown) =>
  (typeof value === 'number' && !Number.isFinite(value)) ||
  value === 'NaN' ||
  value === 'Infinity' ||
  value === '-Infinity';

export const ExpenseDisplaySchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object') return value;
    const row = value as Record<string, unknown>;
    return {
      ...row,
      amount: legacySpecialAmount(row.amount) ? 0 : row.amount,
      amountWasLegacySpecial: legacySpecialAmount(row.amount),
    };
  },
  ExpenseSchema.extend({
    amount: z.number().finite(),
    amountWasLegacySpecial: z.boolean().optional(),
  }).strict()
);

export type ExpenseDisplay = z.infer<typeof ExpenseDisplaySchema>;

export type { ExpenseBranchLabel } from './expense-branch-label';
export { ExpenseBranchLabelSchema } from './expense-branch-label';
export type { ExpenseDetail } from './expense-detail';
export { ExpenseDetailSchema } from './expense-detail';
