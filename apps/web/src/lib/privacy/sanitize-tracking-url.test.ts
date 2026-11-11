import { describe, expect, it } from 'vitest';
import { sanitizeTrackingUrl } from './sanitize-tracking-url';

describe('sanitizeTrackingUrl', () => {
  it('removes sensitive params from an absolute URL and keeps it absolute', () => {
    expect(
      sanitizeTrackingUrl(
        'https://shop.example/checkout/bnpl?orderId=1&trackingToken=abc&email=a%40b.c&customerPhone=080&customerName=Ada'
      )
    ).toBe('https://shop.example/checkout/bnpl?orderId=1');
  });

  it('removes sensitive params from a bare path and keeps it a path', () => {
    expect(sanitizeTrackingUrl('/track-order?token=abc&email=a%40b.c')).toBe(
      '/track-order'
    );
  });

  it('keeps non-sensitive params in their original order', () => {
    expect(sanitizeTrackingUrl('/p?b=2&token=x&a=1')).toBe('/p?b=2&a=1');
  });

  it('removes the fragment', () => {
    expect(sanitizeTrackingUrl('/p?a=1#access_token=secret')).toBe('/p?a=1');
    expect(sanitizeTrackingUrl('https://x.test/p#frag')).toBe(
      'https://x.test/p'
    );
  });

  it('returns URLs without a query unchanged', () => {
    expect(sanitizeTrackingUrl('https://x.test/p')).toBe('https://x.test/p');
    expect(sanitizeTrackingUrl('/')).toBe('/');
  });

  it('matches param names case-insensitively', () => {
    expect(sanitizeTrackingUrl('/p?TrackingToken=abc&a=1')).toBe('/p?a=1');
  });

  it('strips everything after the first ? or # for unparseable input', () => {
    expect(sanitizeTrackingUrl('not a url?token=abc')).toBe('not a url');
    expect(sanitizeTrackingUrl('http://[bad?email=a')).toBe('http://[bad');
  });

  it('returns an empty string unchanged', () => {
    expect(sanitizeTrackingUrl('')).toBe('');
  });
});
