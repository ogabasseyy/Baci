import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flagGuestPaymentProviderConfirmed } from './flag-guest-payment-provider-confirmed';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mockRpc }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('flagGuestPaymentProviderConfirmed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags through the narrow proof-bound RPC', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    await expect(
      flagGuestPaymentProviderConfirmed('order-1', 'tok-1', 'BAC-REF-1')
    ).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'flag_guest_payment_provider_confirmed',
      {
        p_order_id: 'order-1',
        p_tracking_token: 'tok-1',
        p_gateway_reference: 'BAC-REF-1',
      }
    );
  });

  it('reports false without rejecting on RPC failure', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('db down') });
    await expect(
      flagGuestPaymentProviderConfirmed('order-1', 'tok-1', 'BAC-REF-1')
    ).resolves.toBe(false);

    mockRpc.mockRejectedValue(new Error('transport down'));
    await expect(
      flagGuestPaymentProviderConfirmed('order-1', 'tok-1', 'BAC-REF-1')
    ).resolves.toBe(false);
  });
});
