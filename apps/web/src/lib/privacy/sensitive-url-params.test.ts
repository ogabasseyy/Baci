import { describe, expect, it } from 'vitest';
import {
  canonicalSearch,
  isDroppedFromTrackingUrl,
  isSensitiveUrlParam,
  partitionSensitiveSearch,
  trackingSafeSearch,
} from './sensitive-url-params';

describe('isSensitiveUrlParam', () => {
  it.each([
    'token',
    'trackingToken',
    'tracking_token',
    'email',
    'customerEmail',
    'phone',
    'customerPhone',
    'name',
    'customerName',
    'customer_email',
    'customer_name',
    'customer_phone',
    'customer-email',
    'customer-name',
    'customer-phone',
    'tracking-token',
    'payerName',
    'payer_name',
    'payer-name',
  ])('flags %s', (name) => {
    expect(isSensitiveUrlParam(name)).toBe(true);
  });

  it('matches names case-insensitively', () => {
    expect(isSensitiveUrlParam('TrackingToken')).toBe(true);
    expect(isSensitiveUrlParam('EMAIL')).toBe(true);
  });

  it.each([
    'orderId',
    'reference',
    'redirect',
    'gateway',
    'merchant_slug',
  ])('leaves %s alone', (name) => {
    expect(isSensitiveUrlParam(name)).toBe(false);
  });
});

describe('partitionSensitiveSearch', () => {
  it('separates sensitive entries and keeps the remaining order', () => {
    const result = partitionSensitiveSearch(
      '?orderId=1&trackingToken=abc&gateway=klump&email=a%40b.c'
    );

    expect(result.privateEntries).toEqual([
      ['trackingToken', 'abc'],
      ['email', 'a@b.c'],
    ]);
    expect(result.publicSearch).toBe('orderId=1&gateway=klump');
  });

  it('accepts a query without a leading question mark', () => {
    expect(partitionSensitiveSearch('token=x&a=1').publicSearch).toBe('a=1');
  });

  it('returns an empty public search when everything is sensitive', () => {
    const result = partitionSensitiveSearch('token=x');

    expect(result.publicSearch).toBe('');
    expect(result.privateEntries).toEqual([['token', 'x']]);
  });

  it('returns nothing private for an empty query', () => {
    expect(partitionSensitiveSearch('')).toEqual({
      privateEntries: [],
      publicSearch: '',
    });
  });
});

describe('canonicalSearch', () => {
  it('ignores parameter order', () => {
    expect(canonicalSearch('b=2&a=1')).toBe(canonicalSearch('?a=1&b=2'));
  });

  it('accepts URLSearchParams', () => {
    expect(canonicalSearch(new URLSearchParams('b=2&a=1'))).toBe('a=1&b=2');
  });
});

describe('bugfix: snake_case shopper details from the crypto checkout stayed in the address bar', () => {
  it('moves customer_email, customer_name and customer_phone out of the query', () => {
    const result = partitionSensitiveSearch(
      'orderId=1&customer_email=a%40b.c&customer_name=Ada&customer_phone=080'
    );

    expect(result.publicSearch).toBe('orderId=1');
    expect(result.privateEntries.map(([name]) => name)).toEqual([
      'customer_email',
      'customer_name',
      'customer_phone',
    ]);
  });
});

describe('payment-provider identifiers', () => {
  it.each([
    'reference',
    'credpalRef',
    'transaction_id',
    'tx_ref',
    'id',
    'orderId',
  ])('does not treat %s as sensitive, callbacks match on it', (name) => {
    expect(isSensitiveUrlParam(name)).toBe(false);
    expect(isDroppedFromTrackingUrl(name)).toBe(false);
  });
});

describe('isDroppedFromTrackingUrl', () => {
  it.each([
    'redirect',
    'redirectTo',
    'redirect_to',
    'next',
    'returnTo',
    'return_to',
    'callbackUrl',
    'Redirect',
    'token',
    'email',
  ])('drops %s from tracking URLs', (name) => {
    expect(isDroppedFromTrackingUrl(name)).toBe(true);
  });

  it('keeps redirect-style params out of the sensitive (address bar) list', () => {
    expect(isSensitiveUrlParam('redirect')).toBe(false);
    expect(isSensitiveUrlParam('next')).toBe(false);
  });
});

describe('trackingSafeSearch', () => {
  it('removes sensitive and redirect-style params and keeps the rest in order', () => {
    expect(
      trackingSafeSearch(
        '?b=2&redirect=%2Freceipts%2Fclaim%2Fsecret&token=x&a=1&next=%2Fx'
      )
    ).toBe('b=2&a=1');
  });
});
