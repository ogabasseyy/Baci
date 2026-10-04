import { z } from 'zod';

const SafeKoboSchema = z.number().int().safe().nonnegative();
const PositiveKoboSchema = z.number().int().safe().positive();
const UuidSchema = z.string().uuid();

export const SavingsCardContributionOptionsSchema = z
  .object({
    goalId: UuidSchema,
    enabled: z.boolean(),
    newCardEnabled: z.literal(false),
    currency: z.literal('NGN'),
    maximumAmountKobo: SafeKoboSchema,
    savedMethods: z.array(
      z
        .object({
          id: UuidSchema,
          brand: z.string().trim().min(1).max(64),
          last4: z.string().regex(/^\d{4}$/),
        })
        .strict()
    ).max(20),
  })
  .strict();

export const SavingsCardContributionOperationSchema = z
  .object({
    operationId: UuidSchema,
    goalId: UuidSchema,
    amountKobo: PositiveKoboSchema,
    currency: z.literal('NGN'),
    status: z.enum([
      'pending',
      'completed',
      'collection_failed',
      'reconciliation_required',
    ]),
  })
  .strict();

export const SavingsCardContributionRequestSchema = z
  .object({
    goalId: UuidSchema,
    savedMethodId: UuidSchema,
    amountKobo: PositiveKoboSchema,
    idempotencyKey: UuidSchema,
    consent: z
      .object({
        version: z.literal('prefunded-card-v1'),
        oneTimeCharge: z.literal(true),
      })
      .strict(),
  })
  .strict();

export const SavingsCardContributionSnapshotSchema =
  SavingsCardContributionRequestSchema;
