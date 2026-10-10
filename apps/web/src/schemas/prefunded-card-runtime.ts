import { z } from 'zod';

export const prefundedCardRuntimeSchemas = {
  systemIdentifier: z.string().regex(/^[0-9]{1,20}$/),
  readRows: z
    .array(
      z.strictObject({
        result: z.strictObject({
          operationId: z.uuid(),
          collectionStatus: z.enum([
            'not_started',
            'dispatching',
            'action_required',
            'pending',
            'unknown',
            'verified_success',
            'verified_failed',
            'reversed',
          ]),
          transferStatus: z.enum([
            'not_started',
            'dispatching',
            'pending',
            'unknown',
            'verified_success',
            'verified_failed',
          ]),
          projectionStatus: z.enum([
            'unapplied',
            'applied',
            'reconciliation_required',
          ]),
          collectionFence: z.number().int().nonnegative().safe(),
          transferFence: z.number().int().nonnegative().safe(),
        }),
      })
    )
    .length(1),
  projectionRows: z
    .array(
      z.strictObject({ result: z.enum(['applied', 'duplicate', 'deferred']) })
    )
    .length(1),
};
