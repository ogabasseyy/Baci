import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

// The ledger bound for one PiggyVest amount (same as the goal cancel).
const positiveKobo = z.int().positive().max(9999999999);
// The largest goal balance a cancel split accepts (migration 20261112190514);
// the per-transfer ceiling then applies to each leg on its own.
export const GOAL_CANCEL_MAX_SPLIT_BALANCE_KOBO = 999_999_999_999_999;
// The whole interest forfeited by a cancel, which may exceed one transfer
// (the excess goes to review in the database).
const interestKobo = z
  .int()
  .nonnegative()
  .max(GOAL_CANCEL_MAX_SPLIT_BALANCE_KOBO);

/**
 * Database answers for the early-cancel split (migration 20261112190514): the
 * customer gets the principal back, the interest is forfeited by its own leg.
 */
export const piggyvestGoalCancelForfeitSchemas = {
  splitBalanceKobo: z.int().positive().max(GOAL_CANCEL_MAX_SPLIT_BALANCE_KOBO),
  splitRows: z
    .array(
      z.strictObject({
        result: z.discriminatedUnion('status', [
          z.strictObject({
            status: z.literal('dispatched'),
            principalKobo: positiveKobo,
            forfeitedInterestKobo: interestKobo,
          }),
          z.strictObject({
            status: z.enum([
              'not_claimed',
              'needs_review',
              'forfeit_unavailable',
              'too_large',
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
            forfeitedInterestKobo: interestKobo,
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
          // A stuck forfeit; "alert" until the caller acknowledges the page
          // it emitted (by forfeitId), so a person is paged once rather than
          // on every status poll, and never silently.
          z.strictObject({
            status: z.enum(['needs_review', 'unavailable']),
            forfeitId: z.uuid(),
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
              forfeitId: z.uuid(),
              state: z.enum(['reserved', 'dispatched', 'needs_review']),
              alert: z.boolean(),
            })
          )
          .max(200),
      })
    )
    .length(1),
  ackRows: z.array(z.strictObject({ result: z.boolean() })).length(1),
  // manage_goal_cancel_forfeit 'ack' (customer scope).
  manageAckRows: z
    .array(z.strictObject({ result: z.enum(['acked', 'not_released']) }))
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
        // released_needs_review names the forfeit that went to review, so
        // the caller acknowledges exactly that row after paging.
        result: z.union([
          z.enum(['released', 'needs_review', 'not_released']),
          z.custom<`released_needs_review:${string}`>(
            (value) =>
              typeof value === 'string' &&
              /^released_needs_review:[0-9a-f-]{36}$/.test(value)
          ),
        ]),
      })
    )
    .length(1),
  reference: z.string().regex(/^pvb-forfeit-[0-9a-f-]{36}(-[1-9][0-9]{0,5})?$/),
};
