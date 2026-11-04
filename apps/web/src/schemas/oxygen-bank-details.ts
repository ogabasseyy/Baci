import { z } from 'zod';

const base = { workflowId: z.uuid() };
export const oxygenBankRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('banks') }).strict(),
  z
    .object({
      ...base,
      action: z.literal('resolve'),
      bank_code: z.string().regex(/^\d{3,10}$/),
      account_number: z.string().regex(/^\d{10}$/),
    })
    .strict(),
]);
export const oxygenBankListSchema = z.object({
  banks: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(150),
        code: z.string().regex(/^\d{3,10}$/),
      })
    )
    .min(1)
    .max(500),
});
export const oxygenBankProviderListSchema = z.object({
  Status: z.literal('00'),
  Result: z
    .array(
      z.object({
        Name: z.string().trim().min(1).max(150),
        SortCode: z.string().regex(/^\d{3,10}$/),
      })
    )
    .min(1)
    .max(500),
});
export const oxygenAccountNameSchema = z.object({
  accountName: z.string().trim().min(1).max(150),
});
export const oxygenProviderAccountNameSchema = oxygenAccountNameSchema.extend({
  success: z.literal(true),
  errorCode: z.literal(0),
});
