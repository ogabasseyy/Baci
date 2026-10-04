import { expect, it } from '@jest/globals';
import { savingsDraftSchema } from './customer-savings-drafts';
import { draftFixture } from './customer-savings-drafts.test-fixture';

it('accepts an exact unfunded draft and rejects inconsistent consent or variant', () => {
  expect(savingsDraftSchema.safeParse(draftFixture).success).toBe(true);
  expect(
    savingsDraftSchema.safeParse({ ...draftFixture, consent: 'accepted' })
      .success
  ).toBe(false);
  expect(
    savingsDraftSchema.safeParse({ ...draftFixture, variantId: null }).success
  ).toBe(false);
  expect(
    savingsDraftSchema.safeParse({ ...draftFixture, status: 'active' }).success
  ).toBe(false);
});
