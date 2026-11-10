import { z } from 'zod';

const pin = z.string().regex(/^[0-9]{4,6}$/);

// The caller says what the PIN is for; the server builds the proof binding.
export const piggyvestGoalPinSchemas = {
  verifyRequest: z.discriminatedUnion('action', [
    z.strictObject({
      merchantId: z.uuid(),
      pin,
      action: z.literal('fund'),
      goalId: z.uuid(),
      operationId: z.uuid(),
      amountKobo: z.int().positive().max(9999999999),
    }),
    // A cancel proof is bound to the operation id the server issued for this
    // attempt (issue_goal_cancel), so it is required here.
    z.strictObject({
      merchantId: z.uuid(),
      pin,
      action: z.literal('cancel'),
      goalId: z.uuid(),
      operationId: z.uuid(),
    }),
    // A complete proof is bound to the operation id the server issued for
    // this attempt (issue_goal_complete), so it is required here too.
    z.strictObject({
      merchantId: z.uuid(),
      pin,
      action: z.literal('complete'),
      goalId: z.uuid(),
      operationId: z.uuid(),
    }),
  ]),
  pinState: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('set'),
      kdfVersion: z.literal(1),
      salt: z.string().regex(/^[0-9a-f]{32}$/),
      attemptsRemaining: z.int().min(0).max(5),
    }),
    z.strictObject({ status: z.literal('locked'), lockedUntil: z.string() }),
    z.strictObject({
      status: z.enum(['unavailable', 'not_set', 'reset_required']),
    }),
  ]),
  verifyResult: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('verified'),
      proof: z.string().regex(/^[0-9a-f]{64}$/),
      expiresAt: z.string(),
    }),
    z.strictObject({
      status: z.literal('incorrect'),
      attemptsRemaining: z.int().min(0).max(5),
    }),
    z.strictObject({ status: z.literal('locked'), lockedUntil: z.string() }),
    z.strictObject({
      status: z.enum([
        'unavailable',
        'not_set',
        'reset_required',
        'too_many_proofs',
      ]),
    }),
  ]),
};
