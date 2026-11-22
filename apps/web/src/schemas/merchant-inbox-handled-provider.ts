import { z } from 'zod';

/** The provider's filtered conversation list: only the total is read. */
export const providerHandledCountSchema = z.object({
  meta: z.object({ all_count: z.number().int().nonnegative().safe() }),
});
