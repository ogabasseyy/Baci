import { describe, expect, it } from 'vitest';
import { getCreditOrderDvaExpiry } from './get-credit-order-dva-expiry';

describe('getCreditOrderDvaExpiry', () => {
  it('keeps a valid future payment due date alive through the next day', () => {
    expect(
      getCreditOrderDvaExpiry(
        '2026-08-28',
        new Date('2026-08-27T12:00:00.000Z')
      )
    ).toBe('2026-08-29T00:00:00.000Z');
  });

  it('uses a fourteen-day term when the due date is missing or stale', () => {
    const now = new Date('2026-08-27T12:00:00.000Z');

    expect(getCreditOrderDvaExpiry(null, now)).toBe('2026-09-10T12:00:00.000Z');
    expect(getCreditOrderDvaExpiry('2026-08-26', now)).toBe(
      '2026-09-10T12:00:00.000Z'
    );
  });
});
