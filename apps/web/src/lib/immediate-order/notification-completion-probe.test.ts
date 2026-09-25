import { beforeEach, describe, expect, it, vi } from 'vitest';
import { probeImmediateNotificationCompletionProvisioned } from './notification-completion-probe';

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

function wonLease(token: string) {
  return {
    data: [{ claimed: true, claim_status: 'processing', claim_token: token }],
    error: null,
  };
}

const LOST_RECLAIM = {
  data: [{ claimed: false, claim_status: 'processing' }],
  error: null,
};

describe('provisioning probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proofMocks.createProof.mockReturnValue('proof-1');
  });

  it('probes provisioned when the failed release reclaims with a fresh lease', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(wonLease('lease-2'));

    await expect(
      probeImmediateNotificationCompletionProvisioned(
        clientFor(rpc),
        'order-1',
        'tok-1',
        'lease-1'
      )
    ).resolves.toEqual({ provisioned: true, claimToken: 'lease-2' });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'complete_immediate_order_notification_with_proof',
      {
        p_order_id: 'order-1',
        p_tracking_token: 'tok-1',
        p_sent: false,
        p_claim_token: 'lease-1',
        p_completion_proof: 'proof-1',
      }
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'claim_immediate_order_notification_with_proof',
      { p_order_id: 'order-1', p_tracking_token: 'tok-1' }
    );
  });

  it('retries lost reclaims until provisioning lands', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(LOST_RECLAIM)
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(wonLease('lease-3'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      probeImmediateNotificationCompletionProvisioned(
        clientFor(rpc),
        'order-1',
        'tok-1',
        'lease-1',
        { maxAttempts: 3, retryDelayMs: 30_000, sleep }
      )
    ).resolves.toEqual({ provisioned: true, claimToken: 'lease-3' });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it('probes unprovisioned after the retry budget without further waits', async () => {
    // Releases land but every reclaim loses on our own fresh lock.
    const rpc = vi.fn(async (name: string) =>
      name === 'claim_immediate_order_notification_with_proof'
        ? LOST_RECLAIM
        : { data: null, error: null }
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      probeImmediateNotificationCompletionProvisioned(
        clientFor(rpc),
        'order-1',
        'tok-1',
        'lease-1',
        { maxAttempts: 3, sleep }
      )
    ).resolves.toEqual({ provisioned: false, claimToken: null });
    // Two waits between three rounds — none after the last.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('probes unprovisioned without calling the RPC when the secret is unconfigured', async () => {
    proofMocks.createProof.mockImplementation(() => {
      throw new Error('not configured');
    });
    const rpc = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      probeImmediateNotificationCompletionProvisioned(
        clientFor(rpc),
        'order-1',
        'tok-1',
        'lease-1',
        { sleep }
      )
    ).resolves.toEqual({ provisioned: false, claimToken: null });
    expect(rpc).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('probes unprovisioned without rejecting on probe failure', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('db down'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      probeImmediateNotificationCompletionProvisioned(
        clientFor(rpc),
        'order-1',
        'tok-1',
        'lease-1',
        { maxAttempts: 2, sleep }
      )
    ).resolves.toEqual({ provisioned: false, claimToken: null });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('probes unprovisioned without calling the RPC when tokens are missing', async () => {
    const rpc = vi.fn();

    await expect(
      probeImmediateNotificationCompletionProvisioned(
        clientFor(rpc),
        'order-1',
        null,
        'lease-1'
      )
    ).resolves.toEqual({ provisioned: false, claimToken: null });
    await expect(
      probeImmediateNotificationCompletionProvisioned(
        clientFor(rpc),
        'order-1',
        'tok-1',
        null
      )
    ).resolves.toEqual({ provisioned: false, claimToken: null });
    expect(rpc).not.toHaveBeenCalled();
  });
});
