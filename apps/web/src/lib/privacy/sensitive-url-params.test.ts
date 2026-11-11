import { describe, expect, it } from 'vitest';
import {
  canonicalSearch,
  isSensitiveUrlParam,
  partitionSensitiveSearch,
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
