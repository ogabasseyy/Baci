import { expect, it } from 'vitest';
import {
  experienceLegacyEffectSchema,
  experienceModeExitInput,
} from './experience-mode-exit';

const id = '11111111-1111-4111-8111-111111111111';
const base = {
  expectedDraftVersion: 0,
  expectedPublishedVersion: 0,
  targetLegacyRevision: id,
  effect: 'draft-only',
  idempotencyKey: id,
};
it.each([
  'draft-only',
  'restore-legacy',
  'unpublish-legacy-draft',
])('accepts %s with zero and positive versions', (effect) => {
  expect(experienceModeExitInput.parse({ ...base, effect })).toEqual({
    ...base,
    effect,
  });
  expect(
    experienceModeExitInput.safeParse({
      ...base,
      effect,
      expectedDraftVersion: 12,
      expectedPublishedVersion: 4,
    }).success
  ).toBe(true);
});
it('rejects invalid versions, legacy revision, effects, retry keys and extra authority', () => {
  for (const invalid of [
    ...['expectedDraftVersion', 'expectedPublishedVersion'].flatMap((key) =>
      [-1, 0.5, '0', undefined].map((value) => ({ ...base, [key]: value }))
    ),
    { ...base, targetLegacyRevision: 'bad' },
    { ...base, idempotencyKey: 'bad' },
    { ...base, effect: 'publish' },
    { ...base, approved: true },
  ])
    expect(experienceModeExitInput.safeParse(invalid).success).toBe(false);
});

const legacy = {
  namespace: 'baci.full-code.lifecycle.v1',
  action: 'draft-only',
  merchant: id,
  payload: {
    expectedDraftVersion: 1,
    expectedPublishedVersion: 0,
    targetLegacyRevision: id,
  },
  website: id,
  draft: 1,
  published: 0,
  template: 'puck',
  legacy: { config: null },
};
it('accepts an exact legacy intent and rejects a publication or absent target', () => {
  expect(experienceLegacyEffectSchema.parse(legacy)).toEqual(legacy);
  expect(
    experienceLegacyEffectSchema.safeParse({ ...legacy, action: 'publish' })
      .success
  ).toBe(false);
  expect(
    experienceLegacyEffectSchema.safeParse({ ...legacy, website: null }).success
  ).toBe(false);
});
