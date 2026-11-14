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

  describe('Resumed Order Flow', () => {
    it('delegates to executeDirectPayment for resumed orders', async () => {
      const opts = buildOpts({
        resumedOrder: {
          id: 'order-1',
          short_id: 'ORD-1',
          subtotal: 10000,
          shipping_cost: 2000,
          total: 12000,
          customer_name: 'John Doe',
          customer_email: 'john@example.com',
          customer_phone: '+2348012345678',
          shipping_address: {
            address: '123 St',
            city: 'Ikeja',
            state: 'Lagos',
            phone: '+2348012345678',
          },
          items: [],
        },
        preferredGateway: 'credpal',
      });
      await handlePlaceOrder(opts);
      expect(opts.executeDirectPayment).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Invoice Payment', () => {
    it('redirects to order-success for invoice payment', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-inv' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts({ paymentMethod: 'invoice' });
      await handlePlaceOrder(opts);

      expect(opts.clearCheckoutSession).toHaveBeenCalled();
      expect(opts.routerPush).toHaveBeenCalled();
      expect(opts.getHref).toHaveBeenCalledWith(
        '/order-success?type=invoice&orderId=order-inv'
      );
    });
  });

  describe('Wallet Covers Total', () => {
    it('redirects with wallet=true when amountDueToGateway is 0', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-w' },
          wallet: { amountUsed: 12000, newBalance: 5000 },
          amountDueToGateway: 0,
        }),
      });

      const opts = buildOpts({
        payWithWallet: true,
        walletAmountUsed: 12000,
      });
      await handlePlaceOrder(opts);

      expect(opts.setWalletBalance).toHaveBeenCalledWith(5000);
      expect(opts.getHref).toHaveBeenCalledWith(
        '/order-success?orderId=order-w&wallet=true'
      );
    });
  });

  describe('Bank Transfer', () => {
    it('delegates to DVA handler for bank_transfer', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-bt' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts({ paymentMethod: 'bank_transfer' });
      await handlePlaceOrder(opts);

      expect(opts.dva.handleBankTransfer).toHaveBeenCalledWith(
        { id: 'order-bt' },
        12000,
        opts.isOrderInFlightRef,
        opts.setIsProcessing
      );
    });
  });
});
