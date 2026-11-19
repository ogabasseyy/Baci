import { describe, expect, it } from '@jest/globals';
import { readConfirmedContribution } from './read-confirmed-contribution';

describe('readConfirmedContribution', () => {
  it('reads the completed status and the server-confirmed goal balance', () => {
    expect(
      readConfirmedContribution({
        goalCurrentAmount: 1500,
        goalStatus: 'completed',
      })
    ).toEqual({ goalCompleted: true, savedAfter: 1500 });
  });

  it('leaves the balance out when the rail does not return one', () => {
    expect(readConfirmedContribution({ goalStatus: 'active' })).toEqual({
      goalCompleted: false,
    });
  });

  it('reports no verdict when the rail returns no goal status', () => {
    expect(readConfirmedContribution({ status: 'confirmed' })).toEqual({});
  });

  it.each([
    null,
    undefined,
    'ok',
    42,
  ])('treats %p as an unknown result', (value) => {
    expect(readConfirmedContribution(value)).toEqual({});
  });

  it('ignores a non-numeric or non-finite balance', () => {
    expect(
      readConfirmedContribution({ goalCurrentAmount: '1500' }).savedAfter
    ).toBeUndefined();
    expect(
      readConfirmedContribution({ goalCurrentAmount: Number.NaN }).savedAfter
    ).toBeUndefined();
  });
});
