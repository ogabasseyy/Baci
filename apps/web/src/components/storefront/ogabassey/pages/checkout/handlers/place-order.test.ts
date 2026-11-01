import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCreditDirectPopupMarker } from '../credit-direct-popup-return';
import { handlePlaceOrder } from './place-order';
import type { PlaceOrderOptions } from './place-order';

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

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('handlePlaceOrder', () => {
  const buildOpts = (
    overrides: Partial<PlaceOrderOptions> = {},
  ): PlaceOrderOptions => ({
    merchant: { id: 'merchant-1', slug: 'test-store' },
    currency: 'NGN',
    customerEmail: 'john@example.com',
    firstName: 'John',
    lastName: 'Doe',
    customerPhone: '+2348012345678',
    deliveryMethod: 'door',
    isNewAddressMode: true,
    newAddressStreet: '123 Test St',
    newAddressCity: 'Ikeja',
    newAddressState: 'Lagos',
    selectedAddressId: 0,
    addresses: [],
    airportType: 'delivery',
    cart: [
      {
        id: 'p1',
        name: 'Product 1',
        quantity: 2,
        price: 5000,
      },
    ],
    cartTotal: 10000,
    deliveryCost: 2000,
    total: 12000,
    taxAmount: 0,
    giftWrappingCost: 0,
    selectedQuoteId: 'q1',
    shippingQuotes: [
      {
        id: 'q1',
        provider: 'GIGL',
        serviceTier: 'standard',
        carrierName: 'GIG Logistics',
        displayName: 'Standard',
        price: 2000,
        estimatedDays: 3,
        currency: 'NGN',
        pickupIncluded: false,
        insuranceIncluded: false,
      },
    ],
    paymentMethod: 'invoice',
    payWithWallet: false,
    walletAmountUsed: 0,
    createAccount: false,
    accountPassword: '',
    newsletterOptIn: false,
    user: null,
    payForMeDetails: { name: '', contact: '', note: '' },
    resumedOrder: null,
    preferredGateway: null,
    isOrderInFlightRef: { current: false },
    setIsProcessing: vi.fn(),
    setWalletBalance: vi.fn(),
    setCurrentStep: vi.fn(),
    setCompletedSteps: vi.fn(),
    clearCheckoutSession: vi.fn(),
    clearCart: vi.fn(),
    routerPush: vi.fn(),
    getHref: vi.fn((path: string) => `/test-store${path}`),
    executeDirectPayment: vi.fn(),
    crypto: {
      setPendingCryptoOrder: vi.fn(),
      setShowCryptoSelector: vi.fn(),
      setCryptoPaymentData: vi.fn(),
    },
    dva: {
      handleBankTransfer: vi.fn(),
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mockFetch.mockReset();
    window.sessionStorage.clear();
  });

  describe('Validation', () => {
    it('returns early on double-submit', async () => {
      const opts = buildOpts({
        isOrderInFlightRef: { current: true },
      });
      await handlePlaceOrder(opts);
      expect(opts.setIsProcessing).not.toHaveBeenCalled();
    });

    it('shows error toast when merchant is missing', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const opts = buildOpts({ merchant: null });
      await handlePlaceOrder(opts);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error' }),
      );
      expect(opts.isOrderInFlightRef.current).toBe(false);
    });

    it('shows error toast when name/email is missing', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const opts = buildOpts({ firstName: '' });
      await handlePlaceOrder(opts);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Missing Information' }),
      );
    });

    it('shows error toast for incomplete door delivery address', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const opts = buildOpts({ newAddressStreet: '' });
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      await handlePlaceOrder(opts);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Incomplete Address' }),
      );
    });

    // B3 review fix #2 (PR #1611): door delivery without ANY quote
    // must NOT submit. Pre-fix the handler sent `shipping_provider:
    // null + selected_quote_id: null`, which slipped past the RPC's
    // `provider != null AND quote_id IS NULL` guard (both null →
    // guard doesn't fire) and silently persisted a zero-shipping
    // order. The RPC predicate alone can't tell legitimate pickup
    // (no provider, no quote) from broken door-no-quote — the client
    // is the right place to enforce.
    it('shows error toast when door delivery has no selected quote at all', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const opts = buildOpts({
        deliveryMethod: 'door',
        selectedQuoteId: '', // pristine: user never picked a quote
        shippingQuotes: [
          {
            id: 'q-fresh',
            provider: 'GIGL',
            serviceTier: 'standard',
            carrierName: 'GIG Logistics',
            displayName: 'Standard',
            price: 2000,
            estimatedDays: 3,
            currency: 'NGN',
            pickupIncluded: false,
            insuranceIncluded: false,
          },
        ],
      });
      await handlePlaceOrder(opts);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Delivery option required' }),
      );
      // Critical: the order never reaches /api/orders. Pre-fix it would
      // have POSTed `shipping_provider: null + selected_quote_id: null`
      // and got back a silent 200 with zero shipping fee attached.
      expect(mockFetch).not.toHaveBeenCalled();
      expect(opts.isOrderInFlightRef.current).toBe(false);
      expect(opts.setIsProcessing).toHaveBeenCalledWith(false);
    });

    // B3 review fix #1 (PR #1611): door delivery with a selectedQuoteId
    // that no longer exists in `shippingQuotes` (rates refreshed or
    // expired) must NOT fabricate a 'Standard' provider — the order
    // would persist with a phony provider and dangling quote id,
    // sneaking past the new RPC guard. The handler bails with a
    // validation toast so the customer re-picks from fresh rates.
    it('shows error toast when door delivery references a quote id that no longer resolves', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const opts = buildOpts({
        deliveryMethod: 'door',
        selectedQuoteId: 'q-expired-and-refreshed',
        // Quote list has a different id (e.g. user reopened the
        // tab and rates were re-fetched, but the stored
        // selectedQuoteId in their session is stale).
        shippingQuotes: [
          {
            id: 'q-fresh',
            provider: 'GIGL',
            serviceTier: 'standard',
            carrierName: 'GIG Logistics',
            displayName: 'Standard',
            price: 2000,
            estimatedDays: 3,
            currency: 'NGN',
            pickupIncluded: false,
            insuranceIncluded: false,
          },
        ],
      });
      await handlePlaceOrder(opts);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Shipping rate expired' }),
      );
      expect(mockFetch).not.toHaveBeenCalled();
      expect(opts.isOrderInFlightRef.current).toBe(false);
      expect(opts.setIsProcessing).toHaveBeenCalledWith(false);
    });
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

  describe('Order Creation', () => {
    it('creates an order via POST /api/orders', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'new-order-1' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts();
      await handlePlaceOrder(opts);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/orders',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('includes B3.5 VAT + gift wrapping + parity fields in the POST body', async () => {
      // Codex P1 (PR #1622): the handler must propagate the
      // calculate-commerce VAT figure, the gift wrap, and the
      // client's expected_total/client_total so the RPC's parity
      // check (Δ-42 + Δ-39) has a non-NULL value to compare
      // against. Without this assertion a future refactor that
      // drops one of these fields would silently revert B3.5's
      // fail-closed semantics — the RPC would default tax_amount
      // to 0 and the parity check would never run.
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'new-order-b35' },
          wallet: null,
          amountDueToGateway: 12500,
        }),
      });

      const opts = buildOpts({
        taxAmount: 500,
        giftWrappingCost: 300,
        cartTotal: 10000,
        deliveryCost: 2000,
        total: 12800,
      });
      await handlePlaceOrder(opts);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody).toEqual(
        expect.objectContaining({
          tax_amount: 500,
          tax_basis: 'exclusive',
          gift_wrapping_fee: 300,
          expected_total: 12800,
          client_total: 12800,
        }),
      );
    });

    it('includes variantId and variantAttributes in order items', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-variant' },
          wallet: null,
          amountDueToGateway: 720000,
        }),
      });

      const opts = buildOpts({
        cart: [
          {
            id: 'p-variant',
            name: 'MacBook Air M1',
            quantity: 1,
            price: 720000,
            variantId: 'variant-256gb',
            variantAttributes: { storage: '256GB', color: 'Space Gray' },
            hasAssurance: false,
          },
        ],
        cartTotal: 720000,
        total: 720000,
      });
      await handlePlaceOrder(opts);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.items[0]).toEqual(
        expect.objectContaining({
          variantId: 'variant-256gb',
          variantAttributes: { storage: '256GB', color: 'Space Gray' },
        }),
      );
    });

    it('uses the selected saved address for payment billing after leaving new address mode', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            order: { id: 'order-paystack' },
            wallet: null,
            amountDueToGateway: 12000,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            authorization_url: 'https://paystack.test/checkout',
          }),
        });

      const opts = buildOpts({
        paymentMethod: 'paystack',
        isNewAddressMode: false,
        newAddressStreet: 'Stale Manual Street',
        selectedAddressId: 1,
        addresses: [
          {
            id: 1,
            label: 'Home',
            address: '5 Allen Ave, Ikeja, Lagos',
            phone: '+2348012345678',
            isDefault: true,
          },
        ],
      });
      await handlePlaceOrder(opts);

      const initBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(initBody.billing_address).toEqual(
        expect.objectContaining({
          line1: '5 Allen Ave, Ikeja, Lagos',
          city: 'Ikeja',
          state: 'Lagos',
          country: 'NG',
        }),
      );
      // Currency threaded from the merchant-resolved code, not hardcoded.
      expect(initBody.currency).toBe('NGN');
    });

    it('threads the merchant-resolved currency into payment initialization', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            order: { id: 'order-kes' },
            wallet: null,
            amountDueToGateway: 12000,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            authorization_url: 'https://paystack.test/checkout',
          }),
        });

      const opts = buildOpts({
        paymentMethod: 'paystack',
        currency: 'KES',
      });
      await handlePlaceOrder(opts);

      const initBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(initBody.currency).toBe('KES');
    });

    it('throws on failed order creation', async () => {
      const { toast } = await import('@/hooks/use-toast');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      });

      const opts = buildOpts();
      await handlePlaceOrder(opts);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Checkout Failed' }),
      );
      expect(opts.setIsProcessing).toHaveBeenCalledWith(false);
    });

    // FIX C + FIX E: a rejected quiz-prize voucher must surface friendly copy
    // (not the raw RPC code) AND prune the offending line so it stops
    // re-failing every checkout.
    it('prunes the voucher line and shows friendly copy when the voucher is rejected', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const pruneVoucherLines = vi.fn();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Failed to create order',
          details: 'quiz_voucher_award_not_approved',
          rejectedVoucherToken: 'qv1.rejected.signature',
        }),
      });

      const opts = buildOpts({ pruneVoucherLines });
      await handlePlaceOrder(opts);

      expect(pruneVoucherLines).toHaveBeenCalledWith(
        'qv1.rejected.signature',
      );
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Checkout Failed',
          description:
            "This prize isn't available to redeem yet. Please contact support.",
        }),
      );
    });

    it('does not prune voucher lines for a non-voucher order error', async () => {
      const pruneVoucherLines = vi.fn();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Failed to create order',
          details: 'order_total_mismatch',
        }),
      });

      const opts = buildOpts({ pruneVoucherLines });
      await handlePlaceOrder(opts);

      expect(pruneVoucherLines).not.toHaveBeenCalled();
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
        '/order-success?type=invoice&orderId=order-inv',
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
        '/order-success?orderId=order-w&wallet=true',
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
        opts.setIsProcessing,
      );
    });
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
        },
      );
      expect(opts.routerPush).toHaveBeenCalledWith(
        '/test-store/checkout/bnpl?orderId=order-cd&gateway=credit_direct&merchant_slug=test-store&creditDirectCompletion=cd-transaction-1&trackingToken=track-cd&email=john%40example.com',
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
        },
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
        }),
      ).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to persist Credit Direct popup reference:',
        expect.stringContaining('order-cd'),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to persist Credit Direct popup reference:',
        expect.stringContaining('cd-popup-transaction-1'),
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
        'signed-session-only',
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
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
        }),
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
        }),
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
        }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/payments/initialize',
        expect.objectContaining({ method: 'POST' }),
      );
      const initBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(initBody).toEqual(
        expect.objectContaining({
          gateway: 'klump',
          merchant_id: 'merchant-1',
          order_id: 'order-klump',
        }),
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
          json: async () => ({ error: 'Klump is not enabled for this merchant' }),
        });

      const opts = buildOpts({ paymentMethod: 'klump' });
      await handlePlaceOrder(opts);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Checkout Failed',
          description: 'Klump is not enabled for this merchant',
        }),
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

  describe('PayForMe', () => {
    it('redirects with payer name for payforme payment', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-pfm' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts({
        paymentMethod: 'payforme',
        payForMeDetails: {
          name: 'Jane Doe',
          contact: 'jane@example.com',
          note: 'Please pay for me',
        },
      });
      await handlePlaceOrder(opts);

      expect(opts.getHref).toHaveBeenCalledWith(
        expect.stringContaining('type=payforme'),
      );
      expect(opts.getHref).toHaveBeenCalledWith(
        expect.stringContaining('payerName=Jane%20Doe'),
      );
    });
  });

  describe('Shipping Address Building', () => {
    it('uses saved address when not in new address mode', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-sa' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts({
        paymentMethod: 'invoice',
        isNewAddressMode: false,
        selectedAddressId: 1,
        addresses: [
          {
            id: 1,
            label: 'Home',
            address: '5 Allen Ave, Ikeja, Lagos',
            phone: '+2348012345678',
            isDefault: true,
          },
        ],
      });
      await handlePlaceOrder(opts);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.shipping_address.address).toBe(
        '5 Allen Ave, Ikeja, Lagos',
      );
    });

    it('uses pickup address for pickup delivery', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-pk' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts({
        paymentMethod: 'invoice',
        deliveryMethod: 'pickup',
      });
      await handlePlaceOrder(opts);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.shipping_address.address).toBe('Pickup at Store');
      // B3 (plan §5 B3): pickup is a delivery-method label, not a
      // third-party shipping provider. Sending 'Pickup' would trip the
      // RPC's `shipping_quote_required` guard. The handler now sends
      // `shipping_provider: null` for pickup; the delivery method is
      // carried by `shipping_address.address: 'Pickup at Store'`.
      expect(fetchBody.shipping_provider).toBeNull();
      // B3 review fix (PR #1611): the paired B3 field MUST also be
      // null on the wire — partial-payload regressions (e.g., only
      // one field flipped to null) would re-open the RPC-guard
      // bypass vector. Pin both fields in lockstep.
      expect(fetchBody.selected_quote_id).toBeNull();
    });

    it('uses provider quote details for GIGL pickup station delivery', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-station' },
          wallet: null,
          amountDueToGateway: 14_493,
        }),
      });

      const opts = buildOpts({
        deliveryCost: 4493,
        deliveryMethod: 'pickup_station',
        selectedQuoteId: 'station-quote',
        shippingQuotes: [
          {
            id: 'station-quote',
            provider: 'GIGL',
            serviceTier: 'station',
            carrierName: 'GIG Logistics',
            displayName: 'Pickup Stations (GIGL)',
            price: 4493,
            estimatedDays: 3,
            currency: 'NGN',
            pickupIncluded: true,
            insuranceIncluded: true,
            isStationPickup: true,
            stationName: 'PORT HARCOURT',
            stationAddress: 'GIGL Aba Road, Port Harcourt',
          },
        ],
      });
      await handlePlaceOrder(opts);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.shipping_provider).toBe('GIGL');
      expect(fetchBody.selected_quote_id).toBe('station-quote');
      expect(fetchBody.shipping_address.address).toBe(
        'PORT HARCOURT, GIGL Aba Road, Port Harcourt',
      );
    });

    it('omits shipping_provider for airport delivery (B3 — delivery-method labels are not providers)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-ap' },
          wallet: null,
          amountDueToGateway: 5000,
        }),
      });

      const opts = buildOpts({
        paymentMethod: 'invoice',
        deliveryMethod: 'airport',
      });
      await handlePlaceOrder(opts);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.shipping_provider).toBeNull();
      // B3 review fix (PR #1611): paired-field lockstep, same as pickup.
      expect(fetchBody.selected_quote_id).toBeNull();
    });
  });

  describe('Account Creation', () => {
    it('attempts signup when createAccount is true and no user', async () => {
      const { createClient } = await import('@/lib/supabase/client');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-acc' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts({
        paymentMethod: 'invoice',
        createAccount: true,
        accountPassword: 'securepass123',
      });
      await handlePlaceOrder(opts);

      expect(createClient).toHaveBeenCalled();
    });
  });

  describe('Error Recovery', () => {
    it('resets state on checkout error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const opts = buildOpts();
      await handlePlaceOrder(opts);

      expect(opts.setIsProcessing).toHaveBeenCalledWith(false);
      expect(opts.isOrderInFlightRef.current).toBe(false);
      expect(opts.setCurrentStep).toHaveBeenCalledWith('payment');
      expect(opts.setCompletedSteps).toHaveBeenCalledWith({
        contact: true,
        delivery: true,
      });
    });
  });
  it('hands a signed-in local Oxygen checkout to its owned order without financial actions', async () => {
    vi.stubEnv('NODE_ENV','development');
    vi.stubEnv('NEXT_PUBLIC_OXYGEN_LOCAL_CHECKOUT','true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://127.0.0.1:3451');
    mockFetch.mockResolvedValue({ok:true,json:async()=>({order:{id:'60000000-0000-4000-8000-000000000001'},amountDueToGateway:12000})});
    const opts=buildOpts({paymentMethod:'oxygen',user:{id:'user'},payWithWallet:false});
    await handlePlaceOrder(opts);
    expect(opts.routerPush).toHaveBeenCalledWith('/payments/oxygen/60000000-0000-4000-8000-000000000001');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).payment_method).toBe('oxygen');
    expect(opts.clearCart).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it('blocks Oxygen order creation outside local staging', async () => {
    vi.stubEnv('NODE_ENV','production');
    const opts=buildOpts({paymentMethod:'oxygen',user:{id:'user'}});
    await handlePlaceOrder(opts);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(opts.routerPush).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

});
