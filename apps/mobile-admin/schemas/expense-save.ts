import { z } from 'zod';
import { EXPENSE_CATEGORIES } from '@/components/expenses/expense-categories';
import { ExpenseFormSchema } from './expense-form';

export const ReceiptChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unchanged') }).strict(),
  z.object({ kind: z.literal('remove') }).strict(),
  z
    .object({
      kind: z.literal('replace'),
      localUri: z.string().min(1),
      fileName: z.string().nullable().optional(),
      mimeType: z.string().nullable().optional(),
    })
    .strict(),
]);

const EditableDescriptionValuesSchema = ExpenseFormSchema.extend({
  amount: z.number().finite(),
  branchId: z.string().uuid().nullable(),
  category: z.string(),
  description: z.string().nullable(),
});

const EditExpenseInputSchema = z
  .object({
    expectedUpdatedAt: z.string().min(1),
    expenseId: z.string().uuid(),
    merchantId: z.string().uuid(),
    mode: z.literal('edit'),
    originalDescription: z.string().nullable().optional(),
    originalAmount: z.number().finite().optional(),
    amountWasLegacySpecial: z.boolean().optional(),
    originalBranchId: z.string().uuid().nullable().optional(),
    originalCategory: z.string().optional(),
    originalLegacyReceiptUrl: z.string().nullable(),
    originalReceiptStoragePath: z.string().nullable(),
    receiptChange: ReceiptChangeSchema,
    values: EditableDescriptionValuesSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.originalCategory &&
      input.values.category !== input.originalCategory &&
      !EXPENSE_CATEGORIES.includes(
        input.values.category as (typeof EXPENSE_CATEGORIES)[number]
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Category is not supported',
        path: ['values', 'category'],
      });
    }
    if (input.values.branchId === null && input.originalBranchId !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Branch is required',
        path: ['values', 'branchId'],
      });
    }
    const description = input.values.description;
    const originalDescription = input.originalDescription ?? null;
    if (
      input.values.amount <= 0 &&
      input.values.amount !== input.originalAmount
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Amount must be positive',
        path: ['values', 'amount'],
      });
    }
    if (
      input.receiptChange.kind === 'unchanged' &&
      input.originalLegacyReceiptUrl
    ) {
      const parsedUrl = z.url().safeParse(input.originalLegacyReceiptUrl);
      if (
        !parsedUrl.success ||
        !input.originalLegacyReceiptUrl.startsWith('https://')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Legacy receipt URL must use HTTPS when retained',
          path: ['originalLegacyReceiptUrl'],
        });
      }
    }
    if (
      description &&
      description.length > 500 &&
      description !== originalDescription
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Description must be 500 characters or fewer',
        path: ['values', 'description'],
      });
    }
  });

export const SaveExpenseInputSchema = z.discriminatedUnion('mode', [
  z
    .object({
      merchantId: z.string().uuid(),
      mode: z.literal('create'),
      receiptChange: ReceiptChangeSchema,
      values: ExpenseFormSchema,
    })
    .strict(),
  EditExpenseInputSchema,
]);
