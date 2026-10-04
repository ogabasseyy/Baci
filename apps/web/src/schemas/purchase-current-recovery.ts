import { z } from 'zod';
import { purchasePreparationSchemas } from './purchase-preparation';

const kobo = z.number().int().safe().nonnegative();

const current = z.discriminatedUnion('status', [
  z.strictObject({
    observedAt: z.iso.datetime({ offset: true }),
    evidence: z.literal('internal_ledger_only'),
    fundsUse: z.literal('not_authorized'),
    retry: z.literal('not_authorized'),
    status: z.literal('observed'),
    reservation: z.literal('retained'),
    balances: z
      .strictObject({
        unreservedPrincipalKobo: kobo,
        unreservedPaidInterestKobo: kobo,
        pendingInterestKobo: kobo,
      })
      .refine((value) =>
        Number.isSafeInteger(
          value.unreservedPrincipalKobo + value.unreservedPaidInterestKobo
        )
      ),
  }),
  z.strictObject({
    observedAt: z.iso.datetime({ offset: true }),
    evidence: z.literal('internal_ledger_only'),
    fundsUse: z.literal('not_authorized'),
    retry: z.literal('not_authorized'),
    status: z.literal('requires_reconciliation'),
    reservation: z.literal('unknown'),
    balances: z.null(),
  }),
]);

const result = purchasePreparationSchemas.receipt.extend({ current });

export const purchaseCurrentRecoverySchemas = {
  result,
  rows: z.array(z.strictObject({ result })).length(1),
};
