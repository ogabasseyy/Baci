import { describe, expect, it } from 'vitest';
import { oxygenApprovalCodeWindowSchema } from './approval';

describe('Oxygen approval window', () => {
  const window = {
    bookingReference: '690a9d2e-33b7-4106-8c68-b9019f814dce',
    sentAt: '2026-11-04T12:00:00Z',
    expiresAt: '2026-11-04T12:05:00Z',
  };

  it('accepts the five-minute provider window', () => {
    expect(oxygenApprovalCodeWindowSchema.safeParse(window).success).toBe(true);
  });

  it('rejects a changed expiry and unexpected fields', () => {
    expect(
      oxygenApprovalCodeWindowSchema.safeParse({
        ...window,
        expiresAt: '2026-11-04T12:06:00Z',
      }).success
    ).toBe(false);
    expect(
      oxygenApprovalCodeWindowSchema.safeParse({ ...window, extra: true })
        .success
    ).toBe(false);
  });
});
