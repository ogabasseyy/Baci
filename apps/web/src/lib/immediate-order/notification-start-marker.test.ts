import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markImmediateOrderNotificationStarted,
  markImmediateOrderNotificationStartedWithProof,
} from './notification-start-marker';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

function clientFor(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as never;
}

describe('immediate order notification start marker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks started through the proof RPC and reports the lease verdict', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      markImmediateOrderNotificationStartedWithProof(
        clientFor(rpc),
        'order-1',
        'tok-1',
        'lease-1'
      )
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'mark_immediate_order_notification_started_with_proof',
      {
        p_order_id: 'order-1',
        p_tracking_token: 'tok-1',
        p_claim_token: 'lease-1',
      }
    );
  });

  it('reports a lost lease or marker failure as not started', async () => {
    const lost = vi.fn().mockResolvedValue({ data: false, error: null });
    await expect(
      markImmediateOrderNotificationStartedWithProof(
        clientFor(lost),
        'order-1',
        'tok-1',
        'lease-1'
      )
    ).resolves.toBe(false);

    const errored = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error('db down') });
    await expect(
      markImmediateOrderNotificationStartedWithProof(
        clientFor(errored),
        'order-1',
        'tok-1',
        'lease-1'
      )
    ).resolves.toBe(false);

    const base = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(
      markImmediateOrderNotificationStarted(
        clientFor(base),
        'order-1',
        'lease-1'
      )
    ).resolves.toBe(true);
    expect(base).toHaveBeenCalledWith(
      'mark_immediate_order_notification_started',
      { p_order_id: 'order-1', p_claim_token: 'lease-1' }
    );

    const missing = vi.fn();
    await expect(
      markImmediateOrderNotificationStartedWithProof(
        clientFor(missing),
        'order-1',
        null,
        'lease-1'
      )
    ).resolves.toBe(false);
    expect(missing).not.toHaveBeenCalled();
  });
});
