import { z } from 'zod';
import { piggyvestSavingsViewSchemas } from './piggyvest-savings-view';

const text = z.string().trim().min(1).max(200);

export const piggyvestCustomerGoalSchemas = {
  configuration: piggyvestSavingsViewSchemas.configuration,
  scope: z.strictObject({ customerId: z.uuid(), goalId: z.uuid() }),
  actor: z.object({ id: z.uuid() }),
  merchant: z.object({ id: z.uuid() }),
  customer: z.object({
    id: z.uuid(),
    merchant_id: z.uuid(),
    user_id: z.uuid(),
  }),
  row: z.object({
    id: z.uuid(),
    merchant_id: z.uuid(),
    customer_id: z.uuid(),
    product_id: z.uuid(),
    variant_id: z.uuid().nullable(),
    status: z.enum(['active', 'paused', 'completed', 'cancelled', 'spent']),
    product_snapshot: z.unknown(),
    terms_accepted_at: z.unknown(),
    non_withdrawable_accepted_at: z.unknown(),
    early_end_fee_accepted_at: z.unknown(),
  }),
  snapshot: z
    .object({
      name: text,
      variantId: z.uuid().nullable(),
      variantLabel: text.nullable(),
      condition: z.string().trim().min(1).max(100),
      selectionStatus: z.literal('exact'),
    })
    .refine(
      (snapshot) =>
        (snapshot.variantId === null) === (snapshot.variantLabel === null)
    ),
  legacyConsent: z.object({
    terms_accepted_at: z.iso.datetime({ offset: true }),
    non_withdrawable_accepted_at: z.iso.datetime({ offset: true }),
    early_end_fee_accepted_at: z.iso.datetime({ offset: true }).nullable(),
  }),
};
