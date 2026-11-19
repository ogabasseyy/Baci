import { z } from 'zod';
import {
  GOAL_CANCEL_MAX_AMOUNT_KOBO,
  piggyvestGoalCancelSchemas as shared,
} from './piggyvest-goal-cancel';

// Complete moves the same whole goal balance as cancel, so the amount ceiling,
// reservation, wallet and status shapes are the cancel ones. Only the answers
// that complete adds (eligibility, an already settled goal) differ.
export const GOAL_COMPLETE_MAX_AMOUNT_KOBO = GOAL_CANCEL_MAX_AMOUNT_KOBO;

export const piggyvestGoalCompleteSchemas = {
  ...shared,
  issueRows: z
    .array(
      z.strictObject({
        result: z.discriminatedUnion('status', [
          z.strictObject({
            status: z.literal('issued'),
            operationId: z.uuid(),
            expiresAt: z.string(),
          }),
          z.strictObject({
            status: z.enum(['pending', 'confirmed']),
            operationId: z.uuid(),
          }),
          z.strictObject({
            status: z.enum(['busy', 'needs_review', 'not_eligible']),
          }),
        ]),
      })
    )
    .length(1),
  reservationRows: z
    .array(
      z.strictObject({
        result: z.discriminatedUnion('status', [
          z.strictObject({
            status: z.literal('claimed'),
            reservation: z.unknown(),
          }),
          z.strictObject({
            status: z.literal('pin_refused'),
            reason: z.enum([
              'missing',
              'invalid',
              'mismatch',
              'used',
              'expired',
              'unavailable',
            ]),
          }),
          z.strictObject({
            status: z.enum([
              'pending',
              'confirmed',
              'conflict',
              'expired',
              'busy',
              'needs_review',
              'not_eligible',
            ]),
          }),
        ]),
      })
    )
    .length(1),
  // The settled completion whose owner alert is still to be sent.
  purchaseAlert: z.strictObject({
    requestId: z.uuid(),
    operationId: z.uuid(),
  }),
};
