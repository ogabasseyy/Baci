import { z } from 'zod';
export const experienceModeExitInput = z.strictObject({
  expectedDraftVersion: z.number().int().nonnegative(),
  expectedPublishedVersion: z.number().int().nonnegative(),
  targetLegacyRevision: z.uuid(),
  effect: z.enum(['draft-only', 'restore-legacy', 'unpublish-legacy-draft']),
  idempotencyKey: z.uuid(),
});
