import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCreditDirectPopupMarker } from '../credit-direct-popup-return';
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

  describe('Credit Direct', () => {
    it('records SDK evidence and verifies server status before cleanup', async () => {
      const { openCreditDirectCheckout } = await import(
        '@/lib/credit-direct-client'
      );
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            order: { id: 'order-cd', tracking_token: 'track-cd' },
            wallet: null,
            amountDueToGateway: 12000,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

      const opts = buildOpts({ paymentMethod: 'credit_direct' });
      await handlePlaceOrder(opts);

      const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
      callArgs?.onSuccess({
        checkoutTransactionId: 'cd-transaction-1',
        sessionId: 'signed-session-1',
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        '/api/orders/credit-direct/client-completion',
        {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: 'order-cd',
            checkoutTransactionId: 'cd-transaction-1',
            customerEmail: 'john@example.com',
            sessionId: 'signed-session-1',
            tracking_token: 'track-cd',
          }),
        }
      );
      expect(opts.routerPush).toHaveBeenCalledWith(
        '/test-store/checkout/bnpl?orderId=order-cd&gateway=credit_direct&merchant_slug=test-store&creditDirectCompletion=cd-transaction-1&trackingToken=track-cd&email=john%40example.com'
      );
      expect(opts.clearCheckoutSession).not.toHaveBeenCalled();
      expect(opts.clearCart).not.toHaveBeenCalled();
    });

    it('persists the popup transaction reference for webhook reconciliation', async () => {
      const { openCreditDirectCheckout } = await import(
        '@/lib/credit-direct-client'
      );
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            order: { id: 'order-cd', tracking_token: 'track-cd' },
            wallet: null,
            amountDueToGateway: 12000,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

      const opts = buildOpts({ paymentMethod: 'credit_direct' });
      await handlePlaceOrder(opts);

      const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
      expect(callArgs).toBeDefined();
      await callArgs?.onPopup?.({
        checkoutTransactionId: 'cd-popup-transaction-1',
        sessionId: 'signed-session-1',
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        '/api/orders/update-payment-ref',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: 'order-cd',
            paymentRef: 'cd-popup-transaction-1',
            gateway: 'credit_direct',
            tracking_token: 'track-cd',
          }),
        }
      );
    });

    it('logs popup reference persistence failures for webhook reconciliation', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const { openCreditDirectCheckout } = await import(
        '@/lib/credit-direct-client'
      );
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            order: { id: 'order-cd', tracking_token: 'track-cd' },
            wallet: null,
            amountDueToGateway: 12000,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Server Error',
          text: async () => 'write failed',
        });

      const opts = buildOpts({ paymentMethod: 'credit_direct' });
      await handlePlaceOrder(opts);

      const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
      await expect(
        callArgs?.onPopup?.({
          checkoutTransactionId: 'cd-popup-transaction-1',
          sessionId: 'signed-session-1',
        })
      ).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to persist Credit Direct popup reference:',
        expect.stringContaining('order-cd')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to persist Credit Direct popup reference:',
        expect.stringContaining('cd-popup-transaction-1')
      );

      consoleErrorSpy.mockRestore();
    });

    it('keeps a session-only popup marker without persisting it as a transaction id', async () => {
      const { openCreditDirectCheckout } = await import(
        '@/lib/credit-direct-client'
      );
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: { id: 'order-cd', tracking_token: 'track-cd' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts({ paymentMethod: 'credit_direct' });
      await handlePlaceOrder(opts);
      const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];

      await callArgs?.onPopup?.({
        checkoutTransactionId: null,
        sessionId: 'signed-session-only',
      });

      expect(readCreditDirectPopupMarker('order-cd')?.transactionId).toBe(
        'signed-session-only'
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
