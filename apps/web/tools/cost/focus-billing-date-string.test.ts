import { describe, expect, it } from 'vitest';
import { dateString } from './focus-billing-date-string';

describe('dateString', () => {
  it('normalizes valid charge-period timestamps', () => {
    expect(dateString('2026-08-01T00:00:00.000Z', 'ChargePeriodStart')).toBe(
      '2026-08-01T00:00:00.000Z'
    );
  });

  it('rejects impossible calendars', () => {
    expect(() =>
      dateString('2026-02-30T00:00:00.000Z', 'ChargePeriodStart')
    ).toThrow('billing row has an invalid ChargePeriodStart');
  });
});
