import { describe, expect, it } from '@jest/globals';
import { readConfirmedContribution } from './read-confirmed-contribution';

// With PiggyVest off, the legacy manual contribution response still drives
// completion and the confirmed goal balance.
describe('server keeps PiggyVest off', () => {
  it('reads a legacy contribution response', () => {
    expect(
      readConfirmedContribution({
        contributionId: 'c-1',
        goalCurrentAmount: 1500,
        goalStatus: 'active',
        success: true,
        walletBalance: 3500,
        walletTransactionId: null,
      })
    ).toEqual({ goalCompleted: false, savedAfter: 1500 });
  });
});
