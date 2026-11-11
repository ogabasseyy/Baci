// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openCreditDirectCheckout } from './credit-direct-client';

describe('openCreditDirectCheckout', () => {
  const options = {
    amount: 12000,
    customerEmail: 'customer@example.com',
    customerName: 'Ada Customer',
    customerPhone: '08012345678',
    items: [{ id: 'product-1', name: 'Phone Case', price: 12000, quantity: 1 }],
    merchantSlug: 'test-store',
    orderId: 'order-123',
    trackingToken: 'order-tracking-token',
    onClose: vi.fn(),
    onError: vi.fn(),
    onPopup: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    document
      .querySelectorAll(
        'script[src="https://checkout.creditdirect.ng/bnpl/checkout.min.js"]'
      )
      .forEach((script) => {
        script.remove();
      });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          // The server-derived amount is REQUIRED; the client fails closed
          // without it rather than trusting the caller-supplied amount.
          amount: 12000,
          isLive: true,
          publicKey: 'cd-public-key',
          sessionId: 'session-123',
          signature: 'signature-123',
        }),
        ok: true,
      })
    );
    delete window.Connect;
  });

  it('reports sign endpoint errors without opening Credit Direct', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ error: 'Invalid request' }),
        ok: false,
      })
    );

    await openCreditDirectCheckout(options);

    expect(options.onError).toHaveBeenCalledWith('Invalid request');
    expect(options.onSuccess).not.toHaveBeenCalled();
    expect(options.onClose).not.toHaveBeenCalled();
  });

  describe('bugfix: client-controlled popup total when the signed amount is missing', () => {
    it.each([
      ['omitted', undefined],
      ['zero', 0],
      ['negative', -500],
      ['non-numeric', 'abc' as unknown as number],
    ])('fails closed without opening the popup when the server amount is %s', async (_label, serverAmount) => {
      // Arrange: signing response lacks a usable server-derived amount, while
      // the caller supplies 12000 — the value we must NOT fall back to.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: async () => ({
            ...(serverAmount === undefined ? {} : { amount: serverAmount }),
            isLive: true,
            publicKey: 'cd-public-key',
            sessionId: 'session-123',
            signature: 'signature-123',
          }),
          ok: true,
        })
      );
      const setup = vi.fn();
      window.Connect = vi.fn(() => ({
        setup,
      })) as unknown as typeof window.Connect;

      // Act
      await openCreditDirectCheckout(options);

      // Assert: no popup, explicit error, no success path.
      expect(setup).not.toHaveBeenCalled();
      expect(options.onError).toHaveBeenCalledWith(
        'Credit Direct signing response has an invalid amount'
      );
      expect(options.onSuccess).not.toHaveBeenCalled();
    });
  });

  it.each([
    {
      amount: 12000.001,
      error:
        'Credit Direct checkout amount must use at most two decimal places',
      items: options.items,
      label: 'the total has fractional minor units',
    },
    {
      amount: 12000,
      error: 'Credit Direct checkout requires items with a positive total',
      items: [],
      label: 'the basket is empty',
    },
  ])('rejects before signing when $label', async ({ amount, error, items }) => {
    await openCreditDirectCheckout({ ...options, amount, items });

    expect(options.onError).toHaveBeenCalledWith(error);
    expect(fetch).not.toHaveBeenCalled();
    expect(options.onSuccess).not.toHaveBeenCalled();
  });

  it('reports script load failures', async () => {
    const appendSpy = vi
      .spyOn(document.head, 'appendChild')
      .mockImplementation((node) => {
        node.dispatchEvent(new Event('error'));
        return node;
      });

    await openCreditDirectCheckout(options);

    expect(options.onError).toHaveBeenCalledWith(
      'Failed to load Credit Direct script'
    );
    expect(options.onSuccess).not.toHaveBeenCalled();
    expect(options.onClose).not.toHaveBeenCalled();
    appendSpy.mockRestore();
  });

  it('does not report cancellation after Credit Direct emits success then closes', async () => {
    window.Connect = function MockConnect(config: {
      onClose: () => void;
      onSuccess: (payload: { checkoutTransactionId: string }) => void;
    }) {
      return {
        open: () => {
          config.onSuccess({ checkoutTransactionId: 'cd-transaction-123' });
          config.onClose();
        },
        setup: vi.fn(),
      };
    } as never;

    await openCreditDirectCheckout(options);

    expect(options.onSuccess).toHaveBeenCalledWith({
      checkoutTransactionId: 'cd-transaction-123',
      sessionId: 'session-123',
    });
    expect(options.onClose).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('falls back to the signed session id when success has no transaction id', async () => {
    window.Connect = function MockConnect(config: { onSuccess: () => void }) {
      return {
        open: () => config.onSuccess(),
        setup: vi.fn(),
      };
    } as never;

    await openCreditDirectCheckout(options);

    expect(options.onSuccess).toHaveBeenCalledWith({
      checkoutTransactionId: null,
      sessionId: 'session-123',
    });
  });

  it('forwards the tracking token and opens the popup with the server-signed amount', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        // Server-derived amount differs from the passed options.amount (12000)
        // — e.g. a wallet/partial-payment residual. The popup must use it so the
        // total matches the HMAC signature.
        amount: 9999,
        isLive: true,
        publicKey: 'cd-public-key',
        sessionId: 'session-123',
        signature: 'signature-123',
      }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);

    let capturedTotal: number | undefined;
    window.Connect = function MockConnect(config: {
      transaction: { totalAmount: number };
    }) {
      capturedTotal = config.transaction.totalAmount;
      return { open: vi.fn(), setup: vi.fn() };
    } as never;

    await openCreditDirectCheckout(options);

    // F1: the order tracking token is forwarded to the sign endpoint.
    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body
    );
    expect(requestBody.trackingToken).toBe('order-tracking-token');
    // Popup uses the server-signed amount, not the caller-supplied one.
    expect(capturedTotal).toBe(9999);
  });

  it('reports cancellation when Credit Direct closes before success', async () => {
    window.Connect = function MockConnect(config: { onClose: () => void }) {
      return {
        open: () => config.onClose(),
        setup: vi.fn(),
      };
    } as never;

    await openCreditDirectCheckout(options);

    expect(options.onClose).toHaveBeenCalledTimes(1);
    expect(options.onSuccess).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('reports popup transaction ids from the Credit Direct SDK', async () => {
    window.Connect = function MockConnect(config: {
      onPopup: (payload: { checkoutTransactionId: string }) => void;
    }) {
      return {
        open: () =>
          config.onPopup({ checkoutTransactionId: ' cd-popup-transaction-1 ' }),
        setup: vi.fn(),
      };
    } as never;

    await openCreditDirectCheckout(options);

    expect(options.onPopup).toHaveBeenCalledWith({
      checkoutTransactionId: 'cd-popup-transaction-1',
      sessionId: 'session-123',
    });
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('falls back to the signed session id for popup events without a transaction id', async () => {
    window.Connect = function MockConnect(config: {
      onPopup: (payload?: { checkoutTransactionId?: string }) => void;
    }) {
      return {
        open: () => config.onPopup({ checkoutTransactionId: '   ' }),
        setup: vi.fn(),
      };
    } as never;

    await openCreditDirectCheckout(options);

    expect(options.onPopup).toHaveBeenCalledWith({
      checkoutTransactionId: null,
      sessionId: 'session-123',
    });
    expect(options.onError).not.toHaveBeenCalled();
  });
});
