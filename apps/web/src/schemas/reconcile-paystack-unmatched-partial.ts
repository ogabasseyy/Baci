import { z } from 'zod';

export const reconcilePaystackUnmatchedPartialArgsSchema = z.strictObject({
  '--review-id': z.uuid(),
  '--canonical-order-id': z.uuid(),
  '--merchant-id': z.uuid(),
  '--operator-user-id': z.uuid(),
  '--paystack-reference': z.string().min(1),
  '--allow-email-mismatch': z.literal('true').optional(),
});

export type ReconcilePaystackUnmatchedPartialArgs = z.output<
  typeof reconcilePaystackUnmatchedPartialArgsSchema
>;
