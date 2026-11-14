import { describe, expect, it } from '@jest/globals';
import { primaryPendingField } from './primary-pending-field';

const account = {
  accountName: 'OGB / JOHN DOE',
  accountNumber: '9814644749',
  bankName: 'Provider Bank',
  provider: 'piggyvest' as const,
};

describe('primaryPendingField', () => {
  it('adds nothing when the server keeps PiggyVest off or the read failed', () => {
    expect(primaryPendingField({ status: 'not_ready' })).toEqual({});
    expect(primaryPendingField({ status: 'unavailable' })).toEqual({});
  });

  it('adds nothing once the PiggyVest balance is known', () => {
    expect(
      primaryPendingField({ status: 'ready', account, balanceKobo: 0 })
    ).toEqual({});
  });

  it('bugfix: marks a confirmed PiggyVest customer whose account is not ready', () => {
    expect(
      primaryPendingField({ status: 'ready', account: null, balanceKobo: null })
    ).toEqual({ primary_pending: true });
  });
});
