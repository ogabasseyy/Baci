import { describe, expect, it } from 'vitest';
import { getProductImageUrl } from './product-image';

describe('getProductImageUrl', () => {
  it('uses the image field returned by search_products', () => {
    expect(getProductImageUrl({ image: 'https://cdn.ogabassey.com/phone.jpg' }))
      .toBe('https://cdn.ogabassey.com/phone.jpg');
  });

  it('supports the legacy image_url field', () => {
    expect(getProductImageUrl({ image_url: 'https://cdn.ogabassey.com/old.jpg' }))
      .toBe('https://cdn.ogabassey.com/old.jpg');
  });

  it('prefers the proxied image when a legacy URL is also present', () => {
    expect(getProductImageUrl({ image: 'https://mcp.ogabassey.com/images/phone.webp', image_url: 'https://cdn.ogabassey.com/phone.avif' }))
      .toBe('https://mcp.ogabassey.com/images/phone.webp');
  });
});
