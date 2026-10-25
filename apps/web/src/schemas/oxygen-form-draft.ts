import { z } from 'zod';

/** Never add OTPs, consent flags, documents or provider verification facts. */
export const OXYGEN_DRAFT_FIELDS = [
  'first_name',
  'last_name',
  'middle_name',
  'email',
  'bvn',
  'nin',
  'date_of_birth',
  'birth_date_entry',
  'bank_code',
  'account_number',
  'employment_status',
  'name_of_employer',
  'salary_amount',
  'salary_date',
] as const;
const text = z.string().max(100);
export const oxygenFormDraftSchema = z
  .object({
    step: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    fields: z
      .object({
        first_name: text.optional(),
        last_name: text.optional(),
        middle_name: text.optional(),
        email: text.optional(),
        bvn: z.string().max(11).optional(),
        nin: z.string().max(11).optional(),
        date_of_birth: z.string().max(10).optional(),
        birth_date_entry: z.string().max(10).optional(),
        bank_code: z.string().max(20).optional(),
        account_number: z.string().max(10).optional(),
        employment_status: text.optional(),
        name_of_employer: text.optional(),
        salary_amount: z.string().max(30).optional(),
        salary_date: z.string().max(30).optional(),
      })
      .strict(),
  })
  .strict();
export type OxygenFormDraft = z.infer<typeof oxygenFormDraftSchema>;
export const oxygenDraftWriteSchema = z
  .object({
    workflowId: z.uuid(),
    version: z.number().int().nonnegative().max(2_147_483_646),
    idempotencyKey: z.uuid(),
    draft: oxygenFormDraftSchema,
  })
  .strict();
export const oxygenDraftResponseSchema = z
  .object({
    draft: oxygenFormDraftSchema.nullable(),
    version: z.number().int().nonnegative(),
  })
  .strict();
