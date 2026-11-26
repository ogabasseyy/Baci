import { z } from 'zod';
export const experienceModeExitInput = z.strictObject({
  expectedDraftVersion: z.number().int().nonnegative(),
  expectedPublishedVersion: z.number().int().nonnegative(),
  targetLegacyRevision: z.uuid(),
  effect: z.enum(['draft-only', 'restore-legacy', 'unpublish-legacy-draft']),
  idempotencyKey: z.uuid(),
});

const revision = z.number().int().nonnegative();
export const experienceLegacyEffectSchema = z.object({
  namespace: z.literal('baci.full-code.lifecycle.v1'),
  action: experienceModeExitInput.shape.effect,
  merchant: z.uuid(),
  payload: z.object({
    expectedDraftVersion: revision,
    expectedPublishedVersion: revision,
    targetLegacyRevision: z.uuid(),
  }),
  website: z.uuid(),
  draft: revision,
  published: revision,
  template: z.string().nullable(),
  legacy: z.object({ config: z.json(), published: z.boolean().optional() }),
});
