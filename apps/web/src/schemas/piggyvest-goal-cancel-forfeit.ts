import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

// The ledger bound for one PiggyVest amount (same as the goal cancel).
const kobo = z.int().nonnegative().max(9999999999);
const positiveKobo = z.int().positive().max(9999999999);

/**
 * Database answers for the early-cancel split (migration 20261112190514): the
 * customer gets the principal back, the interest is forfeited by its own leg.
 */
export const piggyvestGoalCancelForfeitSchemas = {
  splitRows: z
    .array(
      z.strictObject({
        result: z.discriminatedUnion('status', [
          z.strictObject({
            status: z.literal('dispatched'),
            principalKobo: positiveKobo,
            forfeitedInterestKobo: kobo,
          }),
          z.strictObject({
            status: z.enum([
              'not_claimed',
              'needs_review',
              'forfeit_unavailable',
            ]),
          }),
        ]),
      })
    )
    .length(1),
  amountsRows: z
    .array(
      z.strictObject({
        result: z
          .strictObject({
            principalKobo: positiveKobo,
            forfeitedInterestKobo: kobo,
          })
          .nullable(),
      })
    )
    .length(1),
  // The forfeit transfer itself, shaped like a goal cancel reservation (its
  // operationId is the forfeit id) so the shared proof and lookup apply.
  forfeit: z.strictObject({
    operationId: z.uuid(),
    goalId: z.uuid(),
    amountKobo: positiveKobo,
    sourceWalletId: piggyvestProviderIdSchema,
    destinationWalletId: piggyvestProviderIdSchema,
    reference: z
      .string()
      .regex(/^pvb-forfeit-[0-9a-f-]{36}(-[1-9][0-9]{0,5})?$/),
    businessId: piggyvestProviderIdSchema,
    providerCustomerId: piggyvestProviderIdSchema,
  }),
  claimRows: z
    .array(
      z.strictObject({
        result: z.discriminatedUnion('status', [
          z.strictObject({
            status: z.literal('claimed'),
            forfeit: z.unknown(),
          }),
          z.strictObject({ status: z.literal('pending'), forfeitId: z.uuid() }),
          z.strictObject({
            status: z.enum(['waiting', 'confirmed', 'none']),
          }),
          // A stuck forfeit; "alert" only the first time it is reported, so
          // a person is paged once rather than on every status poll.
          z.strictObject({
            status: z.enum(['needs_review', 'unavailable']),
            alert: z.literal(true).optional(),
          }),
        ]),
      })
    )
    .length(1),
  workRows: z
    .array(
      z.strictObject({
        result: z
          .array(
            z.strictObject({
              operationId: z.uuid(),
              state: z.enum(['reserved', 'dispatched']),
              alert: z.boolean(),
            })
          )
          .max(200),
      })
    )
    .length(1),
  unclaimRows: z
    .array(
      z.strictObject({
        result: z.enum(['unclaimed_first', 'unclaimed', 'not_released']),
      })
    )
    .length(1),
  postingRows: z
    .array(z.strictObject({ result: z.enum(['posting', 'not_released']) }))
    .length(1),
  releaseRows: z
    .array(
      z.strictObject({
        result: z.enum(['released', 'needs_review', 'not_released']),
      })
    )
    .length(1),
  reference: z.string().regex(/^pvb-forfeit-[0-9a-f-]{36}(-[1-9][0-9]{0,5})?$/),
};
