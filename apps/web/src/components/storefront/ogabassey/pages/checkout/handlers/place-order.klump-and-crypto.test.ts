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

  describe('Klump', () => {
    it('blocks Klump before order creation when wallet credit reduces the payable amount', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const opts = buildOpts({
        paymentMethod: 'klump',
        payWithWallet: true,
        walletAmountUsed: 5_000,
      });

      await handlePlaceOrder(opts);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Klump unavailable with wallet credit',
        })
      );
      expect(opts.setIsProcessing).toHaveBeenCalledWith(false);
      expect(opts.isOrderInFlightRef.current).toBe(false);
    });

    it('does not initialize Klump if the order response has a reduced gateway amount', async () => {
      const { toast } = await import('@/hooks/use-toast');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: { id: 'order-klump', tracking_token: 'track-klump' },
          wallet: { amountUsed: 5_000, newBalance: 0 },
          amountDueToGateway: 7_000,
        }),
      });

      const opts = buildOpts({ paymentMethod: 'klump' });
      await handlePlaceOrder(opts);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Klump unavailable with wallet credit',
        })
      );
      expect(opts.setIsProcessing).toHaveBeenCalledWith(false);
      expect(opts.isOrderInFlightRef.current).toBe(false);
    });

    it('initializes Klump payment after creating the order', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            order: { id: 'order-klump', tracking_token: 'track-klump' },
            wallet: null,
            amountDueToGateway: 12000,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            authorization_url: window.location.href,
          }),
        });

      const opts = buildOpts({ paymentMethod: 'klump' });
      await handlePlaceOrder(opts);

      const orderBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(orderBody).toEqual(
        expect.objectContaining({
          payment_method: 'klump',
        })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/payments/initialize',
        expect.objectContaining({ method: 'POST' })
      );
      const initBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(initBody).toEqual(
        expect.objectContaining({
          gateway: 'klump',
          merchant_id: 'merchant-1',
          order_id: 'order-klump',
        })
      );
    });

    it('resets checkout state when Klump initialization fails', async () => {
      const { toast } = await import('@/hooks/use-toast');
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            order: { id: 'order-klump', tracking_token: 'track-klump' },
            wallet: null,
            amountDueToGateway: 12000,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({
            error: 'Klump is not enabled for this merchant',
          }),
        });

      const opts = buildOpts({ paymentMethod: 'klump' });
      await handlePlaceOrder(opts);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Checkout Failed',
          description: 'Klump is not enabled for this merchant',
        })
      );
      expect(opts.setIsProcessing).toHaveBeenCalledWith(false);
      expect(opts.isOrderInFlightRef.current).toBe(false);
      expect(opts.setCurrentStep).toHaveBeenCalledWith('payment');
      expect(opts.setCompletedSteps).toHaveBeenCalledWith({
        contact: true,
        delivery: true,
      });
    });
  });
});
