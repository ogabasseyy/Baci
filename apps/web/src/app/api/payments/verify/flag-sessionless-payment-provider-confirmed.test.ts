import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flagSessionlessPaymentProviderConfirmed } from './flag-sessionless-payment-provider-confirmed';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('flagSessionlessPaymentProviderConfirmed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags through the narrow ownership-bound RPC on the bearer client', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      flagSessionlessPaymentProviderConfirmed({ rpc } as never, 'BAC-REF-1')
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'flag_sessionless_payment_provider_confirmed',
      {
        p_gateway_reference: 'BAC-REF-1',
      }
    );
  });

  it('reports false without rejecting on RPC failure', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error('db down') })
      .mockRejectedValueOnce(new Error('transport down'));

    await expect(
      flagSessionlessPaymentProviderConfirmed({ rpc } as never, 'BAC-REF-1')
    ).resolves.toBe(false);
    await expect(
      flagSessionlessPaymentProviderConfirmed({ rpc } as never, 'BAC-REF-1')
    ).resolves.toBe(false);
  });
});
