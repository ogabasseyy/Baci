import { expect, it } from 'vitest';
import { sameOxygenDraft } from './oxygen-draft-equality';

it('compares step and allowed field values while treating an absent field as empty', () => {
  const current = { step: 1 as const, fields: { first_name: 'Ada' } };
  expect(sameOxygenDraft(null, current)).toBe(false);
  expect(
    sameOxygenDraft(current, {
      step: 1,
      fields: { first_name: 'Ada', last_name: '' },
    })
  ).toBe(true);
  expect(
    sameOxygenDraft(current, { step: 1, fields: { first_name: 'Grace' } })
  ).toBe(false);
  expect(
    sameOxygenDraft(current, { step: 2, fields: { first_name: 'Ada' } })
  ).toBe(false);
});
