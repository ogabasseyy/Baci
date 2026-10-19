import { describe, expect, it } from 'vitest';
import { maskPayoutAccountNumber } from './payout-account-mask';

describe('maskPayoutAccountNumber', () => {
  it('returns only the last four account digits', () => {
    expect(maskPayoutAccountNumber('0123456789')).toBe('••••6789');
  });

  it('does not reveal short malformed account values', () => {
    expect(maskPayoutAccountNumber('12')).toBe('••••');
  });
});
