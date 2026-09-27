import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { executeResumedDirectPayment } from './direct-payment';
import type { ExecuteResumedDirectPaymentOptions } from './direct-payment';
import type { ResumedOrder } from '../types';

// Mock toast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// Mock CredPal
const mockOpenCredPalCheckout = vi.fn();
const mockGetCredPalKey = vi.fn(() => 'test-credpal-key');
vi.mock('@/lib/credpal', () => ({
  openCredPalCheckout: (...args: unknown[]) =>
    mockOpenCredPalCheckout(...args),
  getCredPalKey: () => mockGetCredPalKey(),
}));

// Mock Credit Direct
const mockOpenCreditDirectCheckout = vi.fn();
vi.mock('@/lib/credit-direct-client', () => ({
  openCreditDirectCheckout: (...args: unknown[]) =>
    mockOpenCreditDirectCheckout(...args),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

const mockCaptureCheckoutFunnelEventOnce = vi.fn();
vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: (...args: unknown[]) =>
    mockCaptureCheckoutFunnelEventOnce(...args),
}));

describe('executeResumedDirectPayment', () => {
  const mockResumedOrder: ResumedOrder = {
    id: 'order-123',
    short_id: 'ORD-123',
    subtotal: 10000,
    shipping_cost: 2000,
    total: 12000,
    customer_name: 'John Doe',
    customer_email: 'john@example.com',
    customer_phone: '+2348012345678',
    tracking_token: 'track-token-123',
    shipping_address: {
      address: '123 Test St, Ikeja, Lagos',
      city: 'Ikeja',
      state: 'Lagos',
      phone: '+2348012345678',
    },
    items: [
      {
        id: 'item-1',
        product_id: 'prod-1',
        product_name: 'Test Product',
        quantity: 2,
        price: 5000,
      },
    ],
  };

  const defaultOpts: ExecuteResumedDirectPaymentOptions = {
    resumedOrder: mockResumedOrder,
    preferredGateway: 'credpal',
    merchantSlug: 'test-store',
    merchantChargeCurrency: 'NGN',
    setIsProcessing: vi.fn(),
    clearCheckoutSession: vi.fn(),
    routerPush: vi.fn(),
    getHref: vi.fn((path: string) => `/test-store${path}`),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockOpenCredPalCheckout.mockResolvedValue(undefined);
    mockOpenCreditDirectCheckout.mockResolvedValue(undefined);
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    ) as Mock;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('Early Returns', () => {
    it('returns early if resumedOrder is null', async () => {
      await executeResumedDirectPayment({
        ...defaultOpts,
        resumedOrder: null,
      });
      expect(defaultOpts.setIsProcessing).not.toHaveBeenCalled();
    });

    it('returns early if preferredGateway is null', async () => {
      await executeResumedDirectPayment({
        ...defaultOpts,
        preferredGateway: null,
      });
      expect(defaultOpts.setIsProcessing).not.toHaveBeenCalled();
    });
  });

  describe('CredPal Payment', () => {
    it('sets processing to true before payment', async () => {
      await executeResumedDirectPayment(defaultOpts);
      expect(defaultOpts.setIsProcessing).toHaveBeenCalledWith(true);
    });

    it('calls openCredPalCheckout with correct params', async () => {
      await executeResumedDirectPayment(defaultOpts);
      expect(mockOpenCredPalCheckout).toHaveBeenCalledTimes(1);
      const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
      expect(callArgs.key).toBe('test-credpal-key');
      expect(callArgs.amount).toBe(12000);
      expect(callArgs.product).toBe('Test Product');
      expect(callArgs.customerEmail).toBe('john@example.com');
      expect(callArgs.customerName).toBe('John Doe');
      expect(callArgs.customerPhone).toBe('+2348012345678');
    });

    it('joins multiple product names', async () => {
      const multiItemOrder = {
        ...mockResumedOrder,
        items: [
          ...mockResumedOrder.items,
          {
            id: 'item-2',
            product_id: 'prod-2',
            product_name: 'Another Product',
            quantity: 1,
            price: 3000,
          },
        ],
      };
      await executeResumedDirectPayment({
        ...defaultOpts,
        resumedOrder: multiItemOrder,
      });
      const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
      expect(callArgs.product).toBe('Test Product, Another Product');
    });

    it('uses "Purchase" as product name when items array is empty', async () => {
      const orderWithNoItems: ResumedOrder = {
        ...mockResumedOrder,
        items: [],
      };
      await executeResumedDirectPayment({
        ...defaultOpts,
        resumedOrder: orderWithNoItems,
      });
      const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
      expect(callArgs.product).toBe('Purchase');
    });

    describe('onSuccess callback', () => {
      it('calls update-payment-ref API with correct params', async () => {
        await executeResumedDirectPayment(defaultOpts);
        const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
        await callArgs.onSuccess({ order_no: 'credpal-ref-123' });

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/orders/update-payment-ref',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: 'order-123',
              paymentRef: 'credpal-ref-123',
              gateway: 'credpal',
            }),
          },
        );
      });

      it('clears checkout session after successful payment', async () => {
        await executeResumedDirectPayment(defaultOpts);
        const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
        await callArgs.onSuccess({ order_no: 'credpal-ref-123' });

        expect(defaultOpts.clearCheckoutSession).toHaveBeenCalled();
      });

      it('navigates to order success page with correct query params', async () => {
        await executeResumedDirectPayment(defaultOpts);
        const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
        await callArgs.onSuccess({ order_no: 'credpal-ref-123' });

        expect(defaultOpts.routerPush).toHaveBeenCalledWith(
          '/test-store/order-success?orderId=order-123&type=credpal&trackingToken=track-token-123&reference=credpal-ref-123',
        );
      });

      it('still proceeds even if API call fails', async () => {
        global.fetch = vi.fn(() =>
          Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: 'Update failed' }),
          }),
        ) as Mock;

        await executeResumedDirectPayment(defaultOpts);
        const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
        await callArgs.onSuccess({ order_no: 'credpal-ref-123' });

        expect(defaultOpts.clearCheckoutSession).toHaveBeenCalled();
        expect(defaultOpts.routerPush).toHaveBeenCalled();
      });
    });

    describe('onError callback', () => {
      it('shows toast with error message', async () => {
        await executeResumedDirectPayment(defaultOpts);
        const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
        callArgs.onError({ message: 'Insufficient credit' });

        expect(mockToast).toHaveBeenCalledWith({
          title: 'Payment Failed',
          description: 'Insufficient credit',
          variant: 'destructive',
        });
      });

      it('uses default message when error.message is missing', async () => {
        await executeResumedDirectPayment(defaultOpts);
        const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
        callArgs.onError({});

        expect(mockToast).toHaveBeenCalledWith({
          title: 'Payment Failed',
          description: 'CredPal payment failed',
          variant: 'destructive',
        });
      });

      it('sets processing to false', async () => {
        await executeResumedDirectPayment(defaultOpts);
        const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
        callArgs.onError({ message: 'Payment failed' });

        expect(defaultOpts.setIsProcessing).toHaveBeenCalledWith(false);
      });
    });

    describe('onClose callback', () => {
      it('sets processing to false when modal is closed', async () => {
        await executeResumedDirectPayment(defaultOpts);
        const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
        callArgs.onClose();

        expect(defaultOpts.setIsProcessing).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('Credit Direct Payment', () => {
    it('calls openCreditDirectCheckout with correct params', async () => {
      await executeResumedDirectPayment({
        ...defaultOpts,
        preferredGateway: 'credit_direct',
      });
      expect(mockOpenCreditDirectCheckout).toHaveBeenCalledTimes(1);
      const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
      expect(callArgs.merchantSlug).toBe('test-store');
      expect(callArgs.orderId).toBe('order-123');
      expect(callArgs.amount).toBe(12000);
      expect(callArgs.customerEmail).toBe('john@example.com');
    });

    it('maps item fields correctly', async () => {
      await executeResumedDirectPayment({
        ...defaultOpts,
        preferredGateway: 'credit_direct',
      });
      const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
      expect(callArgs.items).toEqual([
        { id: 'prod-1', name: 'Test Product', price: 5000, quantity: 2 },
      ]);
    });

    it('falls back to ogabassey slug when merchantSlug is empty', async () => {
      await executeResumedDirectPayment({
        ...defaultOpts,
        preferredGateway: 'credit_direct',
        merchantSlug: '',
      });
      const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
      expect(callArgs.merchantSlug).toBe('ogabassey');
    });

    it('persists the popup transaction reference for webhook reconciliation', async () => {
      await executeResumedDirectPayment({
        ...defaultOpts,
        preferredGateway: 'credit_direct',
      });
      const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
      await callArgs.onPopup({
        checkoutTransactionId: 'cd-popup-transaction-1',
        sessionId: 'signed-session-1',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/orders/update-payment-ref',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: 'order-123',
            paymentRef: 'cd-popup-transaction-1',
            gateway: 'credit_direct',
            tracking_token: 'track-token-123',
          }),
        },
      );
    });

    it('logs popup reference persistence failures without throwing', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => 'write failed',
      });

      await executeResumedDirectPayment({
        ...defaultOpts,
        preferredGateway: 'credit_direct',
      });
      const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];

      await expect(
        callArgs.onPopup({
          checkoutTransactionId: 'cd-popup-transaction-1',
          sessionId: 'signed-session-1',
        }),
      ).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledWith(
        'Failed to persist Credit Direct popup reference:',
        expect.stringContaining('order-123'),
      );
      expect(console.error).toHaveBeenCalledWith(
        'Failed to persist Credit Direct popup reference:',
        expect.stringContaining('cd-popup-transaction-1'),
      );
    });

    describe('onSuccess callback', () => {
      it('records separately labelled client completion evidence', async () => {
        await executeResumedDirectPayment({
          ...defaultOpts,
          preferredGateway: 'credit_direct',
        });
        const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
        await callArgs.onSuccess({
          checkoutTransactionId: 'cd-transaction-456',
          sessionId: 'signed-session-1',
        });

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/orders/credit-direct/client-completion',
          {
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: 'order-123',
              checkoutTransactionId: 'cd-transaction-456',
              customerEmail: 'john@example.com',
              sessionId: 'signed-session-1',
              tracking_token: 'track-token-123',
            }),
          },
        );
      });

      it('omits tracking token when the resumed order has none', async () => {
        const orderWithoutToken: ResumedOrder = {
          ...mockResumedOrder,
          tracking_token: undefined,
        };

        await executeResumedDirectPayment({
          ...defaultOpts,
          preferredGateway: 'credit_direct',
          resumedOrder: orderWithoutToken,
        });
        const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
        await callArgs.onSuccess({
          checkoutTransactionId: 'cd-transaction-456',
          sessionId: 'signed-session-1',
        });

        const fetchCall = (global.fetch as Mock).mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body).toEqual({
          orderId: 'order-123',
          checkoutTransactionId: 'cd-transaction-456',
          customerEmail: 'john@example.com',
          sessionId: 'signed-session-1',
        });
        expect(body).not.toHaveProperty('tracking_token');
      });

      it('keeps checkout recovery state until server verification confirms payment', async () => {
        await executeResumedDirectPayment({
          ...defaultOpts,
          preferredGateway: 'credit_direct',
        });
        const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
        await callArgs.onSuccess({
          checkoutTransactionId: 'cd-transaction-456',
          sessionId: 'signed-session-1',
        });

        expect(defaultOpts.clearCheckoutSession).not.toHaveBeenCalled();
      });

      it('navigates to server verification with recovery parameters', async () => {
        await executeResumedDirectPayment({
          ...defaultOpts,
          preferredGateway: 'credit_direct',
        });
        const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
        await callArgs.onSuccess({
          checkoutTransactionId: 'cd-transaction-456',
          sessionId: 'signed-session-1',
        });

        expect(defaultOpts.routerPush).toHaveBeenCalledWith(
          '/test-store/checkout/bnpl?orderId=order-123&gateway=credit_direct&merchant_slug=test-store&creditDirectCompletion=cd-transaction-456&trackingToken=track-token-123&email=john%40example.com',
        );
      });
    });

    describe('onError callback', () => {
      it('shows toast with error message', async () => {
        await executeResumedDirectPayment({
          ...defaultOpts,
          preferredGateway: 'credit_direct',
        });
        const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
        callArgs.onError('Transaction declined');

        expect(mockToast).toHaveBeenCalledWith({
          title: 'Payment Failed',
          description: 'Transaction declined',
          variant: 'destructive',
        });
      });

      it('uses default message when error string is empty', async () => {
        await executeResumedDirectPayment({
          ...defaultOpts,
          preferredGateway: 'credit_direct',
        });
        const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
        callArgs.onError('');

        expect(mockToast).toHaveBeenCalledWith({
          title: 'Payment Failed',
          description: 'Credit Direct payment failed',
          variant: 'destructive',
        });
      });

      it('sets processing to false', async () => {
        await executeResumedDirectPayment({
          ...defaultOpts,
          preferredGateway: 'credit_direct',
        });
        const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
        callArgs.onError('Payment failed');

        expect(defaultOpts.setIsProcessing).toHaveBeenCalledWith(false);
      });
    });

    describe('onClose callback', () => {
      it('sets processing to false when modal is closed', async () => {
        await executeResumedDirectPayment({
          ...defaultOpts,
          preferredGateway: 'credit_direct',
        });
        const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
        callArgs.onClose();

        expect(defaultOpts.setIsProcessing).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('Error Handling', () => {
    it('sets processing to false on credpal SDK error', async () => {
      mockOpenCredPalCheckout.mockRejectedValue(new Error('SDK error'));
      await executeResumedDirectPayment(defaultOpts);
      expect(defaultOpts.setIsProcessing).toHaveBeenCalledWith(false);
      expect(console.error).toHaveBeenCalledWith(
        'Payment execution error:',
        expect.any(Error),
      );
    });

    it('sets processing to false on credit_direct SDK error', async () => {
      mockOpenCreditDirectCheckout.mockRejectedValue(
        new Error('Credit Direct SDK error'),
      );
      await executeResumedDirectPayment({
        ...defaultOpts,
        preferredGateway: 'credit_direct',
      });
      expect(defaultOpts.setIsProcessing).toHaveBeenCalledWith(false);
      expect(console.error).toHaveBeenCalledWith(
        'Payment execution error:',
        expect.any(Error),
      );
    });

    it('handles network errors during API call in credpal onSuccess', async () => {
      global.fetch = vi.fn(() =>
        Promise.reject(new Error('Network error')),
      ) as Mock;

      await executeResumedDirectPayment(defaultOpts);
      const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];

      await expect(
        callArgs.onSuccess({ order_no: 'credpal-ref-123' }),
      ).rejects.toThrow('Network error');
    });

    it('keeps verifying when client-completion recording fails', async () => {
      global.fetch = vi.fn(() =>
        Promise.reject(new Error('Network error')),
      ) as Mock;

      await executeResumedDirectPayment({
        ...defaultOpts,
        preferredGateway: 'credit_direct',
      });
      const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];

      expect(() =>
        callArgs.onSuccess({
          checkoutTransactionId: 'cd-transaction-456',
          sessionId: 'signed-session-1',
        }),
      ).not.toThrow();
      await Promise.resolve();
      expect(defaultOpts.routerPush).toHaveBeenCalledWith(
        '/test-store/checkout/bnpl?orderId=order-123&gateway=credit_direct&merchant_slug=test-store&creditDirectCompletion=cd-transaction-456&trackingToken=track-token-123&email=john%40example.com',
      );
    });
  });

  describe('Edge Cases', () => {
    it('handles single item in order', async () => {
      const singleItemOrder: ResumedOrder = {
        ...mockResumedOrder,
        items: [
          {
            id: 'item-1',
            product_id: 'prod-1',
            product_name: 'Single Product',
            quantity: 1,
            price: 12000,
          },
        ],
      };
      await executeResumedDirectPayment({
        ...defaultOpts,
        resumedOrder: singleItemOrder,
      });
      const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
      expect(callArgs.product).toBe('Single Product');
    });

    it('handles zero total amount', async () => {
      const zeroAmountOrder: ResumedOrder = {
        ...mockResumedOrder,
        subtotal: 0,
        shipping_cost: 0,
        total: 0,
      };
      await executeResumedDirectPayment({
        ...defaultOpts,
        resumedOrder: zeroAmountOrder,
      });
      const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];
      expect(callArgs.amount).toBe(0);
    });

    it('handles items without image_url for credit_direct', async () => {
      const itemsWithoutImages: ResumedOrder = {
        ...mockResumedOrder,
        items: [
          {
            id: 'item-1',
            product_id: 'prod-1',
            product_name: 'Product A',
            quantity: 2,
            price: 5000,
          },
          {
            id: 'item-2',
            product_id: 'prod-2',
            product_name: 'Product B',
            quantity: 1,
            price: 2000,
          },
        ],
      };
      await executeResumedDirectPayment({
        ...defaultOpts,
        preferredGateway: 'credit_direct',
        resumedOrder: itemsWithoutImages,
      });
      const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];
      expect(callArgs.items).toEqual([
        { id: 'prod-1', name: 'Product A', price: 5000, quantity: 2 },
        { id: 'prod-2', name: 'Product B', price: 2000, quantity: 1 },
      ]);
    });

    it('handles empty merchant slug for credpal', async () => {
      await executeResumedDirectPayment({
        ...defaultOpts,
        merchantSlug: '',
      });
      expect(mockOpenCredPalCheckout).toHaveBeenCalled();
    });

    it('handles both resumedOrder and preferredGateway as null', async () => {
      await executeResumedDirectPayment({
        ...defaultOpts,
        resumedOrder: null,
        preferredGateway: null,
      });
      expect(defaultOpts.setIsProcessing).not.toHaveBeenCalled();
      expect(mockOpenCredPalCheckout).not.toHaveBeenCalled();
      expect(mockOpenCreditDirectCheckout).not.toHaveBeenCalled();
    });
  });

  describe('Funnel instrumentation', () => {
    it('records the CredPal start only after the widget loads', async () => {
      await executeResumedDirectPayment(defaultOpts);
      const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];

      // Opener resolved, widget not loaded: no start yet.
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_started',
        expect.anything(),
        expect.anything()
      );

      callArgs.onLoad();
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_started',
        expect.stringMatching(/^order-123:/),
        expect.objectContaining({
          payment_method: 'credpal',
          currency: 'NGN',
          total: 12000,
        })
      );
    });

    it('keeps pre-open CredPal errors out of the funnel but closes opened attempts', async () => {
      await executeResumedDirectPayment(defaultOpts);
      const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];

      callArgs.onError({ message: 'setup failed' });
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_failed',
        expect.anything(),
        expect.anything()
      );

      callArgs.onLoad();
      callArgs.onError({ message: 'declined' });
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_failed',
        expect.stringMatching(/^order-123:/),
        expect.objectContaining({
          payment_method: 'credpal',
          reason: 'credpal_error',
        })
      );
    });

    it('keeps pre-popup Credit Direct errors out of the funnel but closes opened attempts', async () => {
      await executeResumedDirectPayment({
        ...defaultOpts,
        preferredGateway: 'credit_direct',
      });
      const callArgs = mockOpenCreditDirectCheckout.mock.calls[0][0];

      callArgs.onError('init failed');
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_failed',
        expect.anything(),
        expect.anything()
      );

      await callArgs.onPopup({
        checkoutTransactionId: 'cd-popup-1',
        sessionId: 'signed-session-1',
      });
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_started',
        expect.stringMatching(/^order-123:/),
        expect.objectContaining({ payment_method: 'credit_direct' })
      );

      callArgs.onError('declined');
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_failed',
        expect.stringMatching(/^order-123:/),
        expect.objectContaining({
          payment_method: 'credit_direct',
          reason: 'credit_direct_error',
        })
      );
    });

    it('labels resumed events with the stamped order currency', async () => {
      await executeResumedDirectPayment({
        ...defaultOpts,
        resumedOrder: { ...mockResumedOrder, currency: 'USD' },
      });
      const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];

      callArgs.onLoad();
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_started',
        expect.stringMatching(/^order-123:/),
        expect.objectContaining({ currency: 'USD' })
      );

      await callArgs.onSuccess({
        order_no: 'credpal-ref-123',
        status: 'success',
      });
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-123',
        expect.objectContaining({
          currency: 'USD',
          payment_status: 'paid',
          reference: 'credpal-ref-123',
        })
      );
    });

    it('falls back to the merchant charge currency when the order has none stamped', async () => {
      await executeResumedDirectPayment({
        ...defaultOpts,
        merchantChargeCurrency: 'GHS',
      });
      const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];

      callArgs.onLoad();
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_started',
        expect.stringMatching(/^order-123:/),
        expect.objectContaining({ currency: 'GHS' })
      );
    });

    it('skips the completion event for accepted-but-pending CredPal applications', async () => {
      await executeResumedDirectPayment(defaultOpts);
      const callArgs = mockOpenCredPalCheckout.mock.calls[0][0];

      await callArgs.onSuccess({
        order_no: 'credpal-ref-123',
        status: 'pending',
      });

      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_completed',
        expect.anything(),
        expect.anything()
      );
      expect(defaultOpts.clearCheckoutSession).toHaveBeenCalled();
      // The accepted-pending redirect still forwards the provider
      // reference so the success page can attribute the deferred
      // pending-to-paid completion.
      expect(defaultOpts.routerPush).toHaveBeenCalledWith(
        expect.stringContaining('reference=credpal-ref-123')
      );
    });

    it('keys the resumed lifecycle per attempt so a retry re-emits after an opened failure', async () => {
      await executeResumedDirectPayment(defaultOpts);
      const firstAttempt =
        mockOpenCredPalCheckout.mock.calls[0][0];

      firstAttempt.onLoad();
      firstAttempt.onError({ message: 'declined' });

      const firstStartKey = mockCaptureCheckoutFunnelEventOnce.mock.calls.find(
        ([event]) => event === 'payment_started'
      )?.[1];
      expect(firstStartKey).toMatch(/^order-123:/);
      // The failure closes the same attempt it opened.
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_failed',
        firstStartKey,
        expect.objectContaining({ reason: 'credpal_error' })
      );

      // Retry: a new invocation mints a new attempt key, so its start
      // re-emits instead of being suppressed by the failed attempt.
      await executeResumedDirectPayment(defaultOpts);
      const secondAttempt =
        mockOpenCredPalCheckout.mock.calls[1][0];
      secondAttempt.onLoad();

      const startedKeys = mockCaptureCheckoutFunnelEventOnce.mock.calls
        .filter(([event]) => event === 'payment_started')
        .map(([, key]) => key);
      expect(startedKeys).toHaveLength(2);
      expect(startedKeys[0]).not.toBe(startedKeys[1]);
    });
  });
});
