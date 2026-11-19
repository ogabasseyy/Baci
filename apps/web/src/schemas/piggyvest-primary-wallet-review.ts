import { z } from 'zod';

export const piggyvestPrimaryWalletReviewSchemas = {
  reason: z.enum(['routing', 'ownership']).nullable(),
  rows: z
    .array(
      z.strictObject({
        result: z.enum(['routing', 'ownership']).nullable(),
      })
    )
    .length(1),
};
