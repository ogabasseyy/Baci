import { describe, expect, it } from 'vitest';
import { toLagosRefundInstant } from './to-lagos-refund-instant';

describe('toLagosRefundInstant', () => {
  it('stamps the Lagos offset on a datetime-local value', () => {
    expect(toLagosRefundInstant('2026-09-28T13:00')).toBe(
      '2026-09-28T13:00:00+01:00'
    );
  });
  it('keeps seconds callers already supplied', () => {
    expect(toLagosRefundInstant('2026-09-28T13:00:45')).toBe(
      '2026-09-28T13:00:45+01:00'
    );
  });
  it('parses to the same instant regardless of viewer timezone', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Kiritimati';
      expect(Date.parse(toLagosRefundInstant('2026-09-28T13:00'))).toBe(
        Date.parse('2026-09-28T12:00:00Z')
      );
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
  it('preserves invalid input as unparseable', () => {
    expect(Date.parse(toLagosRefundInstant('not-a-date'))).toBeNaN();
    expect(Date.parse(toLagosRefundInstant(''))).toBeNaN();
  });
});
