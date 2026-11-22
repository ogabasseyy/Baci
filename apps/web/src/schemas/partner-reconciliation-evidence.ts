import { z } from 'zod';

const reference = z.string().trim().min(1).max(200);
const moneyEvidence = {
  source: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  amount_minor: z.number().int().positive(),
  currency: z.literal('NGN'),
};
export const evidenceSchema = z.strictObject({
  submission_id: z.uuid(),
  quote_id: z.uuid(),
  partner_order_id: z.string().trim().min(1).max(128),
  capture: z.strictObject({
    ...moneyEvidence,
    provider_account: reference,
    reference,
    captured_at: z.iso.datetime({ offset: true }),
  }),
  settlement: z
    .strictObject({
      ...moneyEvidence,
      settlement_account: reference,
      payout_reference: reference,
      allocation_reference: reference,
      settled_at: z.iso.datetime({ offset: true }),
    })
    .optional(),
});
