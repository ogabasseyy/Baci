import { describe, expect, it } from 'vitest';
import { resolveOptionAwareProductUrl } from './option-aware-product-url';

const base = { id: 'phone-1', name: 'Redmi', slug: 'redmi', price: 90000 };

describe('resolveOptionAwareProductUrl', () => {
  it('keeps a validated option-bearing URL and flags its options', () => {
    const resolved = resolveOptionAwareProductUrl({
      ...base,
      url: 'https://ogabassey.com/products/redmi?variantId=v1&condition=used',
    });
    expect(resolved.url).toBe(
      'https://ogabassey.com/products/redmi?variantId=v1&condition=used'
    );
    expect(resolved.hasOptions).toBe(true);
  });

  it('keeps a validated plain URL without flagging options', () => {
    const resolved = resolveOptionAwareProductUrl({
      ...base,
      url: 'https://ogabassey.com/products/redmi',
    });
    expect(resolved.url).toBe('https://ogabassey.com/products/redmi');
    expect(resolved.hasOptions).toBe(false);
  });

  it('falls back to the slug URL when no URL is served', () => {
    expect(resolveOptionAwareProductUrl(base)).toEqual({
      url: 'https://ogabassey.com/products/redmi',
      hasOptions: false,
    });
  });

  it.each([
    'https://evil.com/products/redmi?variantId=v1',
    'https://ogabassey.com.evil.com/products/redmi',
    'https://ogabassey.com/cart?item_id=phone-1',
    'https://user:pass@ogabassey.com/products/redmi',
    'javascript:alert(1)',
    'not a url',
  ])('rejects an untrusted URL %s', (url) => {
    expect(resolveOptionAwareProductUrl({ ...base, url })).toEqual({
      url: 'https://ogabassey.com/products/redmi',
      hasOptions: false,
    });
  });
});
