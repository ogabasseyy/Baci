import { expect, it } from 'vitest';
import { goalCancelAmountFields } from './goal-cancel-amount-fields';

it('exposes the server split as flat response fields', () => {
  expect(
    goalCancelAmountFields({
      amounts: { principalKobo: 250000, forfeitedInterestKobo: 0 },
    })
  ).toEqual({ principalKobo: 250000, forfeitedInterestKobo: 0 });
});

it('adds nothing when the server has no split', () => {
  expect(goalCancelAmountFields({})).toEqual({});
});
