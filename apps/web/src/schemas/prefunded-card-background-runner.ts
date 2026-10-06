import { z } from 'zod';

export const PREFUNDED_CARD_BACKGROUND_MAX_DISPATCH_BATCH_SIZE = 20;

const dispatchCount = z
  .number()
  .int()
  .min(0)
  .max(PREFUNDED_CARD_BACKGROUND_MAX_DISPATCH_BATCH_SIZE);

const dispatchResult = z
  .strictObject({
    claimed: dispatchCount,
    processed: dispatchCount,
    failed: dispatchCount,
    unacknowledged: dispatchCount,
  })
  .superRefine((result, context) => {
    if (result.processed + result.failed !== result.claimed) {
      context.addIssue({
        code: 'custom',
        path: ['processed'],
        message: 'Every claimed dispatch must finish or fail',
      });
    }
    if (result.unacknowledged > result.claimed) {
      context.addIssue({
        code: 'custom',
        path: ['unacknowledged'],
        message: 'Unacknowledged dispatches cannot exceed claims',
      });
    }
  });

export const prefundedCardBackgroundRunnerSchemas = { dispatchResult };
