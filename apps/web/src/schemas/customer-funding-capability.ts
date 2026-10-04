import { piggyvestPolicyReviewSchemas } from '@baci/shared/contracts';
import { z } from 'zod';
import { piggyvestGoalPolicySchemas } from './piggyvest-goal-policy';
import { piggyvestSavingsLedgerSnapshotSchema } from './piggyvest-savings-ledger-snapshot';

const uuid = z.uuid().transform((value) => value.toLowerCase());

const capability = z.strictObject({
  identity: z.strictObject({
    integrationId: uuid,
    merchantId: uuid,
    customerId: uuid,
    goalId: uuid,
  }),
  policy: z
    .strictObject({
      revisionId: uuid,
      command: piggyvestGoalPolicySchemas.command,
      device: z.object({
        name: z.string().trim().min(1).max(200),
        condition: z.string().trim().min(1).max(100),
        variantId: uuid.nullable(),
        variantLabel: z.string().trim().min(1).max(200).nullable(),
        selectionStatus: z.literal('exact'),
      }),
      actorId: uuid.nullable(),
      acceptedAt: z.iso.datetime({ offset: true }).nullable(),
      durationMonths:
        piggyvestPolicyReviewSchemas.acceptance.shape.durationMonths,
    })
    .refine(
      (row) =>
        row.revisionId === row.command.revisionId &&
        row.device.variantId === row.command.variantId &&
        (row.actorId === null) === (row.acceptedAt === null)
    ),
  ledgerSnapshot: piggyvestSavingsLedgerSnapshotSchema,
});

export const customerFundingCapabilitySchema = z
  .array(z.strictObject({ result: capability.nullable() }))
  .length(1);
