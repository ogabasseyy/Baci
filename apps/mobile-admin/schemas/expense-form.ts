import { z } from 'zod';
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from '@/components/expenses/expense-categories';
import { expenseDateCodec } from '@/lib/expense-date';

const trimmedNullableText = (maximumLength: number) =>
  z
    .string()
    .trim()
    .max(maximumLength)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

export const ExpenseFormSchema = z
  .object({
    amount: z.number().finite().positive(),
    date: z
      .string()
      .refine(
        (value) => expenseDateCodec.fromDateOnly(value) !== null,
        'Expected a valid YYYY-MM-DD expense date'
      ),
    category: z.enum(EXPENSE_CATEGORIES),
    branchId: z.string().uuid(),
    groupId: z.string().uuid().nullable(),
    description: trimmedNullableText(500),
    vendorName: trimmedNullableText(120),
    paymentMethod: trimmedNullableText(120),
    reference: trimmedNullableText(120),
  })
  .strict();

export function createExpenseEditFormSchema(
  originalDescription: string | null,
  originalCategory: string,
  originalAmount?: number,
  originalBranchId?: string | null
) {
  const normalizedOriginal = originalDescription ?? null;

  return ExpenseFormSchema.extend({
    amount: z.number().finite(),
    branchId: z.string().uuid().nullable(),
    category: z.string(),
    description: z
      .string()
      .nullable()
      .transform((value) =>
        value === normalizedOriginal ? value : value?.trim() || null
      ),
  }).superRefine((values, context) => {
    if (
      !EXPENSE_CATEGORIES.includes(values.category as ExpenseCategory) &&
      values.category !== originalCategory
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Category is not supported',
        path: ['category'],
      });
    }
    if (values.branchId === null && originalBranchId !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Branch is required',
        path: ['branchId'],
      });
    }
    if (values.amount <= 0 && values.amount !== originalAmount) {
      context.addIssue({
        code: 'custom',
        message: 'Amount must be positive',
        path: ['amount'],
      });
    }
    if (
      values.description &&
      values.description.length > 500 &&
      values.description !== normalizedOriginal
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Description must be 500 characters or fewer',
        path: ['description'],
      });
    }
  });
}

export const CreateExpenseFormSchema = ExpenseFormSchema;

export type ExpenseFormDraft = z.infer<typeof ExpenseFormSchema>;
export type ExpenseEditFormDraft = Omit<
  ExpenseFormDraft,
  'branchId' | 'category'
> & {
  branchId: string | null;
  category: string;
};
