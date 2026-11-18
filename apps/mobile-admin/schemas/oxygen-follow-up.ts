import { z } from 'zod';

export const oxygenFollowUpMerchantSchema = z.uuid();
export const oxygenFollowUpStatusSchema = z.enum([
  'customer_action',
  'oxygen_processing',
  'approved_pending',
  'needs_review',
]);
export type OxygenFollowUpStatus = z.infer<typeof oxygenFollowUpStatusSchema>;

const candidateStatusSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .transform((status): OxygenFollowUpStatus => {
    const result = oxygenFollowUpStatusSchema.safeParse(status);
    return result.success ? result.data : 'needs_review';
  });

export const oxygenFollowUpCandidateSchema = z
  .object({
    order_id: z.uuid(),
    follow_up_status: candidateStatusSchema,
    last_activity_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export const oxygenFollowUpCandidatesSchema = z
  .array(oxygenFollowUpCandidateSchema)
  .max(250);

export const oxygenFollowUpOrderSchema = z
  .object({
    id: z.uuid(),
    order_number: z.string().nullable(),
    customer_id: z.uuid().nullable(),
    customer_name: z.string().nullable(),
    customer_email: z.string().nullable(),
    customer_phone: z.string().nullable(),
    total: z.union([z.number(), z.string()]).nullable(),
    payment_status: z.string().nullable(),
    payment_method: z.string().nullable(),
    created_at: z.iso.datetime({ offset: true }),
    cancelled_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export const oxygenFollowUpOrdersSchema = z
  .array(oxygenFollowUpOrderSchema)
  .max(250);

export function extractBoundedArray(
  payload: unknown,
  maxItems: number
): { items: unknown[]; isBoundedValid: boolean } {
  const parsed = z.array(z.unknown()).max(maxItems).safeParse(payload);
  if (parsed.success) {
    return { items: parsed.data, isBoundedValid: true };
  }
  return {
    items: Array.isArray(payload) ? payload.slice(0, maxItems) : [],
    isBoundedValid: false,
  };
}
