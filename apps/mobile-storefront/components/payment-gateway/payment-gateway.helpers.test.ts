import {
  getPaymentRedirectReference,
  isPaymentCancellationRedirect,
  isPaymentCompletionRedirect,
  isPlainRecord,
  isSessionPaymentCompletionRedirect,
  PAYMENT_GATEWAY_LABELS,
  PAYMENT_KINDS,
} from './payment-gateway.helpers';

describe('payment-gateway.helpers', () => {
  it('narrows plain records without accepting arrays or nullish values', () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord({ type: 'payment_clipboard_copy' })).toBe(true);
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord(new Date())).toBe(false);
    expect(isPlainRecord(() => undefined)).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord(undefined)).toBe(false);
  });

  it('exposes stable labels and payment kind constants', () => {
    expect(PAYMENT_GATEWAY_LABELS.paystack).toBe('Paystack');
    expect(PAYMENT_KINDS.VTU).toBe('vtu');
    expect(PAYMENT_KINDS.ORDER).toBe('order');
  });

  it('detects payment completion redirects', () => {
    expect(
      isPaymentCompletionRedirect('https://usebaci.com/checkout/success')
    ).toBe(true);
    expect(
      isPaymentCompletionRedirect('https://usebaci.com/orders?trxref=ref-123')
    ).toBe(true);
    expect(isPaymentCompletionRedirect('not-a-url')).toBe(false);
  });

  it('detects explicit cancellation redirects only', () => {
    expect(
      isPaymentCancellationRedirect(
        'https://checkout.example.com/pay?cancelled=true'
      )
    ).toBe(true);
    expect(
      isPaymentCancellationRedirect('https://checkout.example.com/cancel')
    ).toBe(true);
    expect(
      isPaymentCancellationRedirect(
        'https://checkout.example.com/cancelled-order'
      )
    ).toBe(false);
  });

  it('extracts provider references from redirect urls', () => {
    expect(
      getPaymentRedirectReference('https://usebaci.com/orders?trxref=ref-123')
    ).toBe('ref-123');
    expect(
      getPaymentRedirectReference(
        'https://usebaci.com/order-success?reference=ref-456'
      )
    ).toBe('ref-456');
    expect(
      getPaymentRedirectReference('https://usebaci.com/order-success')
    ).toBeUndefined();
    expect(getPaymentRedirectReference('not-a-url')).toBeUndefined();
  });

  it('rejects completion redirects carrying a foreign reference', () => {
    expect(
      isSessionPaymentCompletionRedirect(
        'https://usebaci.com/orders?trxref=ref-123',
        'ref-123'
      )
    ).toBe(true);
    expect(
      isSessionPaymentCompletionRedirect(
        'https://usebaci.com/orders?trxref=ref-999',
        'ref-123'
      )
    ).toBe(false);
    expect(
      isSessionPaymentCompletionRedirect(
        'https://usebaci.com/order-success',
        'ref-123'
      )
    ).toBe(true);
    expect(
      isSessionPaymentCompletionRedirect(
        'https://usebaci.com/orders?trxref=ref-999',
        undefined
      )
    ).toBe(true);
    expect(isSessionPaymentCompletionRedirect('not-a-url', 'ref-123')).toBe(
      false
    );
  });

  it('keeps completion and cancellation redirect matches mutually exclusive', () => {
    const completionUrls = [
      'https://usebaci.com/checkout/success',
      'https://usebaci.com/order-success',
      'https://usebaci.com/orders?trxref=ref-123',
    ];
    const cancellationUrls = [
      'https://checkout.example.com/pay?cancelled=true',
      'https://checkout.example.com/pay?cancel=true',
      'https://checkout.example.com/cancel',
    ];

    for (const url of completionUrls) {
      expect(isPaymentCompletionRedirect(url)).toBe(true);
      expect(isPaymentCancellationRedirect(url)).toBe(false);
    }

    for (const url of cancellationUrls) {
      expect(isPaymentCancellationRedirect(url)).toBe(true);
      expect(isPaymentCompletionRedirect(url)).toBe(false);
    }
  });
});
