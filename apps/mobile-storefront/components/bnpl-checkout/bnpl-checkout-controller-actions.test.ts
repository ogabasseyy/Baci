import { describe, expect, it, jest } from '@jest/globals';
import {
  resolveBNPLNavigationUrlEffect,
  resolveBNPLPopupTargetAction,
  shouldHandleBNPLNavigationMessage,
} from './bnpl-checkout-controller-actions';

jest.mock('./bnpl-checkout-message-handler', () => ({
  logBNPLCheckoutDebug: jest.fn(),
}));

describe('resolveBNPLNavigationUrlEffect', () => {
  it('returns success with the extracted reference for order success URLs', () => {
    expect(
      resolveBNPLNavigationUrlEffect(
        'https://shop.example.com/order-success?reference=ref_123'
      )
    ).toEqual({
      isPending: false,
      reference: 'ref_123',
      status: 'success',
    });
  });

  it('marks accepted-but-pending CredPal results as non-paid success', () => {
    expect(
      resolveBNPLNavigationUrlEffect(
        'https://shop.example.com/order-success?type=credpal&credpalStatus=pending'
      )
    ).toEqual({
      isPending: true,
      reference: null,
      status: 'success',
    });
  });

  it('treats approved CredPal results as paid success', () => {
    expect(
      resolveBNPLNavigationUrlEffect(
        'https://shop.example.com/order-success?type=credpal&credpalStatus=success'
      )
    ).toEqual({
      isPending: false,
      reference: null,
      status: 'success',
    });
  });

  it('treats every Klump return as pending until the tracked order settles', () => {
    expect(
      resolveBNPLNavigationUrlEffect(
        'https://shop.example.com/order-success?reference=klump_tx_1',
        { gateway: 'klump' }
      )
    ).toEqual({
      isPending: true,
      reference: 'klump_tx_1',
      status: 'success',
    });
  });

  it('returns to the app for checkout cancellation URLs', () => {
    expect(
      resolveBNPLNavigationUrlEffect(
        'https://shop.example.com/checkout?cancelled=true'
      )
    ).toEqual({
      status: 'return-to-app',
    });
  });

  it('returns parsed error messages for checkout error URLs', () => {
    expect(
      resolveBNPLNavigationUrlEffect(
        'https://shop.example.com/checkout?error=Provider%20declined'
      )
    ).toEqual({
      errorMessage: 'Provider declined',
      status: 'error',
    });
  });

  it('returns app-exit effects for trusted merchant URLs outside checkout', () => {
    expect(
      resolveBNPLNavigationUrlEffect('https://ogabassey.com/', {
        apiBaseUrl: 'https://usebaci.com',
        merchantDomain: 'ogabassey.com',
        merchantSlug: 'ogabassey',
      })
    ).toEqual({
      status: 'return-to-app',
    });
  });

  it('ignores unrelated navigation URLs', () => {
    expect(
      resolveBNPLNavigationUrlEffect('https://shop.example.com/products')
    ).toBeNull();
  });
});

describe('shouldHandleBNPLNavigationMessage', () => {
  const apiBaseUrl = 'https://www.baci.shop';

  it('accepts trusted merchant return URLs', () => {
    expect(
      shouldHandleBNPLNavigationMessage({
        apiBaseUrl,
        merchantSlug: 'demo',
        url: 'https://www.baci.shop/demo/order-success?reference=ref_123',
      })
    ).toBe(true);
  });

  it('rejects provider-origin navigation messages', () => {
    expect(
      shouldHandleBNPLNavigationMessage({
        apiBaseUrl,
        merchantSlug: 'demo',
        url: 'https://pay.example-provider.com/success?reference=ref_123',
      })
    ).toBe(false);
  });
});

describe('resolveBNPLPopupTargetAction', () => {
  const apiBaseUrl = 'https://www.baci.shop';

  it('ignores blank provider popup windows', () => {
    expect(
      resolveBNPLPopupTargetAction({
        apiBaseUrl,
        targetUrl: 'about:blank#blocked',
      })
    ).toEqual({ type: 'ignore' });
  });

  it('loads trusted merchant popup return URLs', () => {
    expect(
      resolveBNPLPopupTargetAction({
        apiBaseUrl,
        merchantSlug: 'demo',
        targetUrl: 'https://www.baci.shop/demo/checkout/bnpl?_rsc=abc',
      })
    ).toEqual({
      targetUrl: 'https://www.baci.shop/demo/checkout/bnpl',
      type: 'load',
    });
  });

  it('loads trusted Paystack auxiliary checkout subdomains', () => {
    expect(
      resolveBNPLPopupTargetAction({
        apiBaseUrl,
        merchantSlug: 'demo',
        targetUrl: 'https://link.paystack.com/90lqd13ljptyujh',
      })
    ).toEqual({
      targetUrl: 'https://link.paystack.com/90lqd13ljptyujh',
      type: 'load',
    });
  });

  it('rejects Paystack lookalike auxiliary checkout hosts', () => {
    expect(
      resolveBNPLPopupTargetAction({
        apiBaseUrl,
        merchantSlug: 'demo',
        targetUrl: 'https://paystack.com.evil.example/90lqd13ljptyujh',
      })
    ).toEqual({
      targetUrl: 'https://paystack.com.evil.example/90lqd13ljptyujh',
      type: 'untrusted',
    });
  });

  it('rejects untrusted auxiliary windows', () => {
    expect(
      resolveBNPLPopupTargetAction({
        apiBaseUrl,
        merchantSlug: 'demo',
        targetUrl: 'https://evil.example/checkout/bnpl',
      })
    ).toEqual({
      targetUrl: 'https://evil.example/checkout/bnpl',
      type: 'untrusted',
    });
  });
});
