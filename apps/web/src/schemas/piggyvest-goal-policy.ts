import { piggyvestPolicyReviewSchemas } from '@baci/shared/contracts';
import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const durationMonths =
  piggyvestPolicyReviewSchemas.acceptance.shape.durationMonths;

const command = z.strictObject({
  revisionId: uuid,
  expectedGoalUpdatedAt: z.iso.datetime({ offset: true }),
  productId: uuid,
  variantId: uuid.nullable(),
  termsVersion: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  termsHash: z.string().regex(/^[0-9a-f]{64}$/),
  quoteId: z.string().min(1).max(128),
  quoteKobo: z.number().int().safe().positive(),
  quoteExpiresAt: z.iso.datetime({ offset: true }),
  guarantee: z.null(),
  lifecycle: z.literal('draft'),
  collectionPaused: z.literal(true),
});
const stored = z
  .strictObject({
    revisionId: uuid,
    command,
    device: z.object({
      name: z.string().trim().min(1).max(200),
      condition: z.string().trim().min(1).max(100),
      variantId: uuid.nullable(),
      variantLabel: z.string().trim().min(1).max(200).nullable(),
      selectionStatus: z.literal('exact'),
    }),
    actorId: uuid.nullable(),
    acceptedAt: z.iso.datetime({ offset: true }).nullable(),
    durationMonths,
  })
  .refine(
    (row) =>
      row.revisionId === row.command.revisionId &&
      row.device.variantId === row.command.variantId &&
      (row.actorId === null) === (row.acceptedAt === null)
  );

export const piggyvestGoalPolicySchemas = {
  configuration: z.strictObject({
    environment: z.literal('staging'),
    integrationId: uuid,
    merchantId: uuid,
    customerId: uuid,
    goalId: uuid,
    expectedBusinessId: piggyvestProviderIdSchema,
  }),
  command,
  acceptance: z.strictObject({
    revisionId: uuid,
    actorId: uuid,
    durationMonths,
  }),
  staged: z
    .array(
      z.strictObject({
        result: z.strictObject({
          revisionId: uuid,
          outcome: z.literal('staged'),
        }),
      })
    )
    .length(1),
  accepted: z
    .array(
      z.strictObject({
        result: z.strictObject({
          revisionId: uuid,
          outcome: z.literal('accepted'),
        }),
      })
    )
    .length(1),
  read: z.array(z.strictObject({ result: stored.nullable() })).length(1),
};
