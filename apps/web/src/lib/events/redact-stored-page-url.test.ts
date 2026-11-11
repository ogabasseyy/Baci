import { describe, expect, it } from 'vitest';
import { redactStoredPageUrl } from './redact-stored-page-url';

describe('bugfix: shopper PII stored in analytics page URLs', () => {
  it('drops email, phone, name and token from the BNPL checkout URL', () => {
    const result = redactStoredPageUrl(
      'https://shop.example/checkout/bnpl?email=a%40b.com&customerPhone=0801&token=abc'
    );
    expect(result).toBe('https://shop.example/checkout/bnpl');
  });

  it('keeps campaign attribution parameters only', () => {
    const result = redactStoredPageUrl(
      'https://shop.example/p?utm_source=meta&token=x#frag'
    );
    expect(result).toBe('https://shop.example/p?utm_source=meta');
  });

  it('strips query from unparsable values', () => {
    expect(redactStoredPageUrl('/x?email=a@b.com')).toBe('/x');
  });

  it('keeps ad click ids for attribution', () => {
    expect(
      redactStoredPageUrl('https://shop.example/p?fbclid=abc&email=a@b.com')
    ).toBe('https://shop.example/p?fbclid=abc');
  });

  it('matches attribution parameter names case-insensitively', () => {
    expect(
      redactStoredPageUrl(
        'https://shop.example/p?FBCLID=abc&UTM_Source=x&token=t'
      )
    ).toBe('https://shop.example/p?FBCLID=abc&UTM_Source=x');
  });
});
