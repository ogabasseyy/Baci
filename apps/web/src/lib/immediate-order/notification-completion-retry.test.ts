import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeNotificationWithProvisioningRetry } from './notification-completion-retry';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const proofMocks = vi.hoisted(() => ({ createProof: vi.fn() }));

vi.mock('./notification-completion-proof', () => ({
  createImmediateNotificationCompletionProof: proofMocks.createProof,
}));

function clientFor(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as never;
}

function checkRow(status: string, claimed: boolean, token: string | null) {
  return {
    data: [{ claimed, claim_status: status, claim_token: token }],
    error: null,
  };
}

describe('provisioning completion retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proofMocks.createProof.mockReturnValue('proof-1');
  });

  it('completes on the first round when the terminal status lands', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(checkRow('sent', false, null));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      completeNotificationWithProvisioningRetry(
        clientFor(rpc),
        'order-1',
        'tok-1',
        true,
        'lease-1',
        { sleep }
      )
    ).resolves.toEqual({ completed: true });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'complete_immediate_order_notification_with_proof',
      {
        p_order_id: 'order-1',
        p_tracking_token: 'tok-1',
        p_sent: true,
        p_claim_token: 'lease-1',
        p_completion_proof: 'proof-1',
      }
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries an unlanded completion until the terminal status records', async () => {
    const rpc = vi
      .fn()
      // Round 1: no-op (unprovisioned), still processing under our lease.
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(checkRow('processing', false, null))
      // Round 2: lands.
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(checkRow('sent', false, null));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      completeNotificationWithProvisioningRetry(
        clientFor(rpc),
        'order-1',
        'tok-1',
        true,
        'lease-1',
        { maxAttempts: 3, retryDelayMs: 30_000, sleep }
      )
    ).resolves.toEqual({ completed: true });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it('adopts a re-won lease when the original expires mid-retry', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(checkRow('processing', true, 'lease-2'))
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(checkRow('sent', false, null));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      completeNotificationWithProvisioningRetry(
        clientFor(rpc),
        'order-1',
        'tok-1',
        true,
        'lease-1',
        { maxAttempts: 3, sleep }
      )
    ).resolves.toEqual({ completed: true });
    // The second completion carries the adopted lease.
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      'complete_immediate_order_notification_with_proof',
      expect.objectContaining({ p_claim_token: 'lease-2' })
    );
  });

  it('reports uncompleted after the retry budget without further waits', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'claim_immediate_order_notification_with_proof'
        ? checkRow('processing', false, null)
        : { data: null, error: null }
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      completeNotificationWithProvisioningRetry(
        clientFor(rpc),
        'order-1',
        'tok-1',
        true,
        'lease-1',
        { maxAttempts: 3, sleep }
      )
    ).resolves.toEqual({ completed: false });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('fails fast without calling the RPC when the secret is unconfigured', async () => {
    proofMocks.createProof.mockImplementation(() => {
      throw new Error('not configured');
    });
    const rpc = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      completeNotificationWithProvisioningRetry(
        clientFor(rpc),
        'order-1',
        'tok-1',
        true,
        'lease-1',
        { sleep }
      )
    ).resolves.toEqual({ completed: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('records failed outcomes against the failed terminal status', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(checkRow('failed', false, null));

    await expect(
      completeNotificationWithProvisioningRetry(
        clientFor(rpc),
        'order-1',
        'tok-1',
        false,
        'lease-1'
      )
    ).resolves.toEqual({ completed: true });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'complete_immediate_order_notification_with_proof',
      expect.objectContaining({ p_sent: false })
    );
  });

  it('returns uncompleted without calling the RPC when tokens are missing', async () => {
    const rpc = vi.fn();

    await expect(
      completeNotificationWithProvisioningRetry(
        clientFor(rpc),
        'order-1',
        null,
        true,
        'lease-1'
      )
    ).resolves.toEqual({ completed: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});
