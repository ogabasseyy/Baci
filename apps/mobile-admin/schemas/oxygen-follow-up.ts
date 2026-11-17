import { z } from 'zod';

export const oxygenFollowUpMerchantSchema = z.uuid();
export const oxygenFollowUpStatusSchema = z.enum([
  'customer_action',
  'oxygen_processing',
  'approved_pending',
  'needs_review',
]);
export type OxygenFollowUpStatus = z.infer<typeof oxygenFollowUpStatusSchema>;

export const oxygenFollowUpCandidatesSchema = z
  .array(
    z
      .object({
        order_id: z.uuid(),
        follow_up_status: oxygenFollowUpStatusSchema,
        last_activity_at: z.iso.datetime({ offset: true }),
      })
      .strict()
  )
  .max(250);

export const oxygenFollowUpOrdersSchema = z
  .array(
    z
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
      })
      .strict()
  )
  .max(250);
