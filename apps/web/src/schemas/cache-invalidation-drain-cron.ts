import { z } from 'zod';
import { cacheInvalidationClaimSchema } from './cache-invalidation-claim';

export const cacheInvalidationDrainCronResponseSchemas = {
  claims: z.array(cacheInvalidationClaimSchema).max(5),
  deadLetters: z.boolean(),
};
