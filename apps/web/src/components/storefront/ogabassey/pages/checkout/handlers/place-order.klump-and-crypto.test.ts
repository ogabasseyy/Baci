import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlaceOrder } from './place-order';

// Mock dependencies
vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/credpal', () => ({
  openCredPalCheckout: vi.fn(),
}));

vi.mock('@/lib/credit-direct-client', () => ({
  openCreditDirectCheckout: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  })),
}));

import { buildOpts, mockFetch } from './place-order.test-helpers';

global.fetch = mockFetch;

describe('handlePlaceOrder', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mockFetch.mockReset();
    window.sessionStorage.clear();
  });

  describe('Crypto (Juicyway)', () => {
    it('opens crypto selector for juicyway payment', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-crypto' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts({ paymentMethod: 'juicyway' });
      await handlePlaceOrder(opts);

      expect(opts.crypto.setPendingCryptoOrder).toHaveBeenCalled();
      expect(opts.crypto.setShowCryptoSelector).toHaveBeenCalledWith(true);
      expect(opts.setIsProcessing).toHaveBeenCalledWith(false);
    });
  });

  describe('retired Klump', () => {
    it.each([false, true])('rejects stale Klump selection without creating an order (credit: %s)', async (payWithWallet) => {
      const { toast } = await import('@/hooks/use-toast');
      const opts = buildOpts({ paymentMethod: 'klump', payWithWallet, walletAmountUsed: payWithWallet ? 2000 : 0 });
      await handlePlaceOrder(opts);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Klump is no longer available' }));
      expect(opts.isOrderInFlightRef.current).toBe(false);
    });
  });
});
