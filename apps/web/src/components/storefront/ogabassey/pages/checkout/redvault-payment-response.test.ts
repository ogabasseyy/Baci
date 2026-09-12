import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({
  CSRF_HEADER_NAME: 'x-csrf-token',
  getClientCsrfToken: () => 'checkout-csrf',
}));

import {
  initializeRedvaultPayment,
  parseRedvaultOrderQuote,
} from './redvault-payment-response';

const input = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  orderId: 'order-1',
  currency: 'NGN',
  customerEmail: 'ada@example.com',
  customerName: 'Ada Buyer',
  customerPhone: '+2348123456789',
  billingAddress: { line1: '1 Marina', city: 'Lagos', country: 'NG' },
};

describe('REDVAULT checkout response handling', () => {
  it('sends CSRF and JSON headers using the real default request helper', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        authorization_url: 'https://checkout.paystack.com/example',
      })
    );
    try {
      await initializeRedvaultPayment(input);
      const options = request.mock.calls[0][1];
      expect(new Headers(options?.headers).get('x-csrf-token')).toBe(
        'checkout-csrf'
      );
      expect(new Headers(options?.headers).get('content-type')).toBe(
        'application/json'
      );
      expect(options?.credentials).toBe('include');
    } finally {
      request.mockRestore();
    }
  });
  it.each([
    202, 500,
  ])('rejects an unrecognized HTTP %s response even with a URL', async (status) => {
    const request = vi.fn().mockResolvedValue(
      Response.json(
        {
          authorization_url: 'https://checkout.paystack.com/example',
        },
        { status }
      )
    );
    await expect(initializeRedvaultPayment(input, request)).rejects.toThrow();
  });
  it('parses only the frozen quote fields emitted by the protected order response', () => {
    expect(
      parseRedvaultOrderQuote({
        redvault: {
          quote: {
            product_subtotal_kobo: 500_000,
            eligible_subtotal_kobo: 400_000,
            discount_kobo: 20_000,
            ineligible_subtotal_kobo: 100_000,
            tax_kobo: 750,
            shipping_kobo: 500,
            gift_wrapping_kobo: 0,
            payable_kobo: 481_250,
            mixed_basket: true,
          },
        },
      })
    ).toEqual({
      productSubtotalKobo: 500_000,
      eligibleSubtotalKobo: 400_000,
      discountKobo: 20_000,
      ineligibleSubtotalKobo: 100_000,
      taxKobo: 750,
      shippingKobo: 500,
      giftWrappingKobo: 0,
      payableKobo: 481_250,
      mixedBasket: true,
    });
  });

  it('uses the CSRF-aware request with the isolated Paystack REDVAULT fields', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        Response.json({ authorization_url: 'https://paystack.test/checkout' })
      );

    await expect(initializeRedvaultPayment(input, request)).resolves.toEqual({
      kind: 'authorization_url',
      authorizationUrl: 'https://paystack.test/checkout',
    });
    expect(request).toHaveBeenCalledWith(
      '/api/payments/initialize',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"payment_method":"uba_redvault"'),
      })
    );
  });

  it('keeps reconciliation-required initialization pending instead of claiming a received payment', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { code: 'REDVAULT_RECONCILIATION_REQUIRED' },
          { status: 202 }
        )
      );

    await expect(initializeRedvaultPayment(input, request)).resolves.toEqual({
      kind: 'pending_reconciliation',
    });
  });

  it('preserves the received-payment hold state only for an explicit capture-held response', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        Response.json({ code: 'REDVAULT_CAPTURE_HELD' }, { status: 202 })
      );

    await expect(initializeRedvaultPayment(input, request)).resolves.toEqual({
      kind: 'captured_held',
    });
  });
});
