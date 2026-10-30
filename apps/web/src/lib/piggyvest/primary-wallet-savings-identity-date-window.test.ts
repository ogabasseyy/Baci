import { describe, expect, it } from 'vitest';
import { primarySavingsIdentityDateWindow } from './primary-wallet-savings-identity-date-window';

describe('primary savings identity date window', () => {
  it('returns a one-day window around the parsed instant in UTC', () => {
    expect(
      primarySavingsIdentityDateWindow('2025-01-02T12:00:00+02:00')
    ).toEqual({
      startDate: '2025-01-01T10:00:00.000Z',
      endDate: '2025-01-03T10:00:00.000Z',
    });
  });

  it.each([
    undefined,
    null,
    'not-a-date',
    '2025-01-02T12:00:00',
    '',
  ])('rejects an invalid or offset-free date value: %j', (value) => {
    expect(primarySavingsIdentityDateWindow(value)).toBeNull();
  });
});
