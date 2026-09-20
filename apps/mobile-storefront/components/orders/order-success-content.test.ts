import { describe, expect, it } from '@jest/globals';
import {
  getOrderSuccessDeliveryLabel,
  getOrderSuccessTone,
  isDeferredSettlementMethod,
  resolveOrderSuccessDeliveryEstimate,
} from './order-success-content';

describe('order success content helpers', () => {
  it('returns invoice messaging for invoice orders', () => {
    expect(getOrderSuccessTone('invoice')).toMatchObject({
      documentLabel: 'View / Download Proforma Invoice',
      eyebrow: 'Proforma invoice ready',
      nextDocumentTitle: 'Proforma Invoice',
      title: 'Proforma Invoice Ready!',
    });
  });

  it('returns receipt messaging for paid invoice orders', () => {
    expect(getOrderSuccessTone('invoice', true)).toMatchObject({
      documentLabel: 'View Receipt',
      eyebrow: 'Order confirmed',
      nextDocumentTitle: 'Receipt',
      title: 'Order Confirmed',
    });
  });

  it('returns payment request messaging for pay-for-me orders', () => {
    expect(getOrderSuccessTone('payforme')).toMatchObject({
      documentLabel: 'View / Download Invoice',
      eyebrow: 'Payment request ready',
      nextDocumentTitle: 'Invoice',
      title: 'Payment Request Created',
    });
  });

  it('returns receipt messaging for paid orders', () => {
    expect(getOrderSuccessTone('paystack')).toMatchObject({
      documentLabel: 'View Receipt',
      eyebrow: 'Order confirmed',
      nextDocumentTitle: 'Receipt',
      title: 'Order Confirmed',
    });
  });

  it('returns receipt messaging for settled pay-for-me orders', () => {
    expect(getOrderSuccessTone('payforme', true)).toMatchObject({
      documentLabel: 'View Receipt',
      eyebrow: 'Order confirmed',
      nextDocumentTitle: 'Receipt',
      title: 'Order Confirmed',
    });
  });

  it('resolves authoritative paid state only for deferred-settlement methods', () => {
    // The success screen enables its receipt-detail lookup for these.
    expect(isDeferredSettlementMethod('invoice')).toBe(true);
    expect(isDeferredSettlementMethod('payforme')).toBe(true);
    expect(isDeferredSettlementMethod('paystack')).toBe(false);
    expect(isDeferredSettlementMethod(undefined)).toBe(false);
  });

  it('normalizes delivery estimate labels', () => {
    const fallback = resolveOrderSuccessDeliveryEstimate(' ');

    expect(fallback).toBe('Shared after order confirmation');
    expect(getOrderSuccessDeliveryLabel(' ')).toBe('Delivery Timeline');
    expect(getOrderSuccessDeliveryLabel()).toBe('Delivery Timeline');
    expect(getOrderSuccessDeliveryLabel('2 business days')).toBe(
      'Estimated Delivery'
    );
  });
});
