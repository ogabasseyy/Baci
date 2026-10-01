import { describe, expect, it } from 'vitest';
import { canCancelAdminNotification } from './notification-cancellation';

describe('canCancelAdminNotification', () => {
  it('allows only pending, unsent notification work to be cancelled', () => {
    expect(
      canCancelAdminNotification({
        delivery_state: 'pending',
        sent_at: null,
        delivery_attempts: 0,
      })
    ).toBe(true);
  });

  it('hides cancellation after a delivery attempt has started', () => {
    expect(
      canCancelAdminNotification({
        delivery_state: 'pending',
        sent_at: null,
        delivery_attempts: 1,
      })
    ).toBe(false);
  });

  it.each([
    'processing',
    'sent',
    'failed',
    'expired',
  ] as const)('retains %s delivery history', (deliveryState) => {
    expect(
      canCancelAdminNotification({
        delivery_state: deliveryState,
        sent_at: deliveryState === 'sent' ? '2026-08-05T12:00:00.000Z' : null,
        delivery_attempts: 0,
      })
    ).toBe(false);
  });
});
