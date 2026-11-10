import { expect, it } from 'vitest';
import { experienceOwnerIntentInput } from './experience-owner-intent';

it('accepts owner intent locators and rejects model approval flags or unknown actions', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const input = {
    action: 'publish',
    merchantId: id,
    input: {
      storefrontId: id,
      buildId: id,
      expectedDraftVersion: 0,
      expectedPublishedVersion: 0,
      idempotencyKey: id,
    },
  };
  expect(experienceOwnerIntentInput.safeParse(input).success).toBe(true);
  expect(
    experienceOwnerIntentInput.safeParse({ ...input, approved: true }).success
  ).toBe(false);
  expect(
    experienceOwnerIntentInput.safeParse({ ...input, action: 'confirm' })
      .success
  ).toBe(false);
});
