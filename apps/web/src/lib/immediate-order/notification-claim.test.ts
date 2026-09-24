import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimImmediateOrderNotification,
  claimImmediateOrderNotificationWithProof,
  completeImmediateOrderNotification,
  completeImmediateOrderNotificationWithProof,
} from './notification-claim';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

function clientFor(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as never;
}

describe('immediate order notification claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wins delivery on the first claim', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          claimed: true,
          claim_status: 'processing',
          claim_token: 'lease-1',
        },
      ],
      error: null,
    });

    await expect(
      claimImmediateOrderNotification(clientFor(rpc), 'order-1')
    ).resolves.toEqual({ shouldDeliver: true, claimToken: 'lease-1' });
    expect(rpc).toHaveBeenCalledWith('claim_immediate_order_notification', {
      p_order_id: 'order-1',
    });
  });

  it('skips when another attempt is delivering or already sent', async () => {
    for (const claim_status of ['processing', 'sent']) {
      const rpc = vi.fn().mockResolvedValue({
        data: [{ claimed: false, claim_status }],
        error: null,
      });

      await expect(
        claimImmediateOrderNotification(clientFor(rpc), 'order-1')
      ).resolves.toEqual({ shouldDeliver: false, claimToken: null });
    }
  });

  it('resumes a failed claim on replay', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          claimed: true,
          claim_status: 'processing',
          claim_token: 'lease-1',
        },
      ],
      error: null,
    });

    await expect(
      claimImmediateOrderNotification(clientFor(rpc), 'order-1')
    ).resolves.toEqual({ shouldDeliver: true, claimToken: 'lease-1' });
  });

  it('skips a won claim that carries no lease token', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ claimed: true, claim_status: 'processing' }],
      error: null,
    });

    await expect(
      claimImmediateOrderNotification(clientFor(rpc), 'order-1')
    ).resolves.toEqual({ shouldDeliver: false, claimToken: null });
  });

  it('skips completion without calling the RPC when the lease is missing', async () => {
    const rpc = vi.fn();

    await completeImmediateOrderNotification(
      clientFor(rpc),
      'order-1',
      true,
      null
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('skips delivery when the claim RPC errors instead of double-sending', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error('db down') });

    await expect(
      claimImmediateOrderNotification(clientFor(rpc), 'order-1')
    ).resolves.toEqual({ shouldDeliver: false, claimToken: null });
  });

  it('records sent and failed completions', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await completeImmediateOrderNotification(
      clientFor(rpc),
      'order-1',
      true,
      'lease-1'
    );
    expect(rpc).toHaveBeenCalledWith('complete_immediate_order_notification', {
      p_order_id: 'order-1',
      p_sent: true,
      p_claim_token: 'lease-1',
    });

    await completeImmediateOrderNotification(
      clientFor(rpc),
      'order-1',
      false,
      'lease-1'
    );
    expect(rpc).toHaveBeenCalledWith('complete_immediate_order_notification', {
      p_order_id: 'order-1',
      p_sent: false,
      p_claim_token: 'lease-1',
    });
  });

  it('never rejects on completion failure', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('db down'));

    await expect(
      completeImmediateOrderNotification(
        clientFor(rpc),
        'order-1',
        true,
        'lease-1'
      )
    ).resolves.toBeUndefined();
  });

  it('claims through the proof RPC with the tracking token', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          claimed: true,
          claim_status: 'processing',
          claim_token: 'lease-1',
        },
      ],
      error: null,
    });

    await expect(
      claimImmediateOrderNotificationWithProof(
        clientFor(rpc),
        'order-1',
        'tok-1'
      )
    ).resolves.toEqual({ shouldDeliver: true, claimToken: 'lease-1' });
    expect(rpc).toHaveBeenCalledWith(
      'claim_immediate_order_notification_with_proof',
      { p_order_id: 'order-1', p_tracking_token: 'tok-1' }
    );
  });

  it('skips proof delivery without calling the RPC when the token is missing', async () => {
    const rpc = vi.fn();

    await expect(
      claimImmediateOrderNotificationWithProof(clientFor(rpc), 'order-1', null)
    ).resolves.toEqual({ shouldDeliver: false, claimToken: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('records proof completions with the tracking token', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await completeImmediateOrderNotificationWithProof(
      clientFor(rpc),
      'order-1',
      'tok-1',
      true,
      'lease-1'
    );
    expect(rpc).toHaveBeenCalledWith(
      'complete_immediate_order_notification_with_proof',
      {
        p_order_id: 'order-1',
        p_tracking_token: 'tok-1',
        p_sent: true,
        p_claim_token: 'lease-1',
      }
    );
  });

  it('skips proof completion without calling the RPC when the token is missing', async () => {
    const rpc = vi.fn();

    await completeImmediateOrderNotificationWithProof(
      clientFor(rpc),
      'order-1',
      null,
      true,
      'lease-1'
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
