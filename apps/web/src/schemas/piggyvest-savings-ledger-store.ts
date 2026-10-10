import { z } from 'zod';
import { piggyvestSavingsLedgerSnapshotSchema } from './piggyvest-savings-ledger-snapshot';

export const piggyvestSavingsLedgerStoreSchemas = {
  identity: z
    .object({
      integrationId: z.uuid(),
      merchantId: z.uuid(),
      customerId: z.uuid(),
      goalId: z.uuid(),
    })
    .strict(),
  acknowledgement: z
    .array(
      z
        .object({
          result: z
            .object({
              operationId: z.uuid(),
              outcome: z.literal('recorded'),
            })
            .strict(),
        })
        .strict()
    )
    .length(1),
  snapshot: z
    .array(z.object({ result: piggyvestSavingsLedgerSnapshotSchema }).strict())
    .length(1),
};
