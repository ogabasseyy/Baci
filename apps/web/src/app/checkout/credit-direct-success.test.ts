// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCreditDirectPopupMarker } from '@/components/storefront/ogabassey/pages/checkout/credit-direct-popup-return';
import { handoffLegacyCreditDirectSuccess } from './credit-direct-success';

const mocks = vi.hoisted(() => ({ fetchWithCsrf: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: mocks.fetchWithCsrf,
}));

describe('handoffLegacyCreditDirectSuccess', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mocks.fetchWithCsrf.mockReset();
    mocks.fetchWithCsrf.mockReturnValue(new Promise(() => undefined));
  });

  it('uses the CSRF-aware fetcher by default', () => {
    const navigate = vi.fn();

    handoffLegacyCreditDirectSuccess({
      orderId: 'order-1',
      signedSessionId: 'signed-session-1',
      customerEmail: 'buyer@example.com',
      merchantSlug: 'test-store',
      navigate,
    });

    expect(mocks.fetchWithCsrf).toHaveBeenCalledWith(
      '/api/orders/credit-direct/client-completion',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          orderId: 'order-1',
          customerEmail: 'buyer@example.com',
          sessionId: 'signed-session-1',
        }),
      })
    );
  });

  it('keeps navigation non-blocking when CSRF completion capture fails', async () => {
    mocks.fetchWithCsrf.mockRejectedValueOnce(
      new Error('CSRF completion request failed')
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const navigate = vi.fn();

    try {
      handoffLegacyCreditDirectSuccess({
        orderId: 'order-1',
        signedSessionId: 'signed-session-1',
        customerEmail: 'buyer@example.com',
        merchantSlug: 'test-store',
        navigate,
      });

      expect(navigate).toHaveBeenCalledWith(
        '/test-store/checkout/bnpl?orderId=order-1&gateway=credit_direct&merchant_slug=test-store&email=buyer%40example.com'
      );
      await vi.waitFor(() =>
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to record Credit Direct client completion:',
          'CSRF completion request failed'
        )
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('captures evidence before handing the legacy checkout to verification', () => {
    const fetcher = vi.fn().mockReturnValue(new Promise(() => undefined));
    const navigate = vi.fn();

    handoffLegacyCreditDirectSuccess(
      {
        orderId: 'order-1',
        signedSessionId: 'signed-session-1',
        checkoutTransactionId: 'checkout-transaction-1',
        trackingToken: 'track-1',
        customerEmail: 'buyer@example.com',
        merchantSlug: 'test-store',
        basePath: '/test-store',
        navigate,
      },
      fetcher
    );

    expect(readCreditDirectPopupMarker('order-1')?.transactionId).toBe(
      'checkout-transaction-1'
    );
    expect(fetcher).toHaveBeenCalledWith(
      '/api/orders/credit-direct/client-completion',
      {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: 'order-1',
          checkoutTransactionId: 'checkout-transaction-1',
          customerEmail: 'buyer@example.com',
          sessionId: 'signed-session-1',
          tracking_token: 'track-1',
        }),
      }
    );
    expect(navigate).toHaveBeenCalledWith(
      '/test-store/checkout/bnpl?orderId=order-1&gateway=credit_direct&merchant_slug=test-store&trackingToken=track-1&email=buyer%40example.com'
    );
    expect(fetcher.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0]
    );
  });

  it('falls back to the signed session when SDK success omits its transaction id', () => {
    const fetcher = vi.fn().mockReturnValue(new Promise(() => undefined));
    const navigate = vi.fn();

    handoffLegacyCreditDirectSuccess(
      {
        orderId: 'order-1',
        signedSessionId: 'signed-session-1',
        customerEmail: 'buyer@example.com',
        merchantSlug: 'test-store',
        navigate,
      },
      fetcher
    );

    expect(readCreditDirectPopupMarker('order-1')?.transactionId).toBe(
      'signed-session-1'
    );
    expect(fetcher).toHaveBeenCalledWith(
      '/api/orders/credit-direct/client-completion',
      expect.objectContaining({
        body: JSON.stringify({
          orderId: 'order-1',
          customerEmail: 'buyer@example.com',
          sessionId: 'signed-session-1',
        }),
      })
    );
  });

  it('preserves the empty base path for a custom-domain checkout', () => {
    const fetcher = vi.fn().mockReturnValue(new Promise(() => undefined));
    const navigate = vi.fn();

    handoffLegacyCreditDirectSuccess(
      {
        orderId: 'order-1',
        signedSessionId: 'signed-session-1',
        trackingToken: 'track-1',
        customerEmail: 'buyer@example.com',
        merchantSlug: 'test-store',
        basePath: '',
        navigate,
      },
      fetcher
    );

    expect(navigate).toHaveBeenCalledWith(
      '/checkout/bnpl?orderId=order-1&gateway=credit_direct&merchant_slug=test-store&trackingToken=track-1&email=buyer%40example.com'
    );
  });
});
