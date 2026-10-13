import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  randomUUID: () => '12345678-1234-1234-1234-abcdef123456',
}));

import { generateOrderNumber } from './manual-order-number';

describe('generateOrderNumber', () => {
  it('pads the day and month, formats the year, and normalizes the UUID', () => {
    // Local-date fixture: generateOrderNumber reads local calendar fields, so
    // a UTC instant would shift days under far-east timezones (UTC+12 and up).
    expect(generateOrderNumber(new Date(2026, 0, 2, 12, 0, 0))).toBe(
      'ORD-020126-123456'
    );
  });
});
