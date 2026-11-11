import { describe, expect, it } from 'vitest';
import { sanitizeTrackingUrl } from './sanitize-tracking-url';
import { TRACKING_URL_INLINE_SANITIZER } from './tracking-url-inline-sanitizer';

const inline = new Function(
  `${TRACKING_URL_INLINE_SANITIZER}; return baciSanitizeUrl;`
)() as (url: string) => string;

describe('TRACKING_URL_INLINE_SANITIZER', () => {
  it.each([
    'https://shop.example/checkout/bnpl?orderId=1&trackingToken=abc&email=a%40b.c#x',
    '/track-order?token=abc&email=a%40b.c',
    '/p?b=2&TrackingToken=x&a=1',
    'https://x.test/p',
    'https://x.test/p#frag',
    '/p?customerName=Ada&customerPhone=080',
    'not a url?token=abc',
    '',
  ])('behaves like sanitizeTrackingUrl for %s', (url) => {
    expect(inline(url)).toBe(sanitizeTrackingUrl(url));
  });
});
