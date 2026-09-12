import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  randomUUID: () => '12345678-1234-1234-1234-abcdef123456',
}));

import { generateOrderNumber } from './manual-order-number';

describe('generateOrderNumber', () => {
  it('pads the day and month, formats the year, and normalizes the UUID', () => {
    expect(generateOrderNumber(new Date('2026-01-02T12:00:00.000Z'))).toBe(
      'ORD-020126-123456'
    );
  });
});
