import { describe, expect, it } from 'vitest';
import { generateFacebookCatalogFeed } from '../facebook/feed-builder';
import {
  type FeedProduct,
  generateGoogleMerchantFeed,
  type ImageManifestMap,
} from './feed-builder';

const product: FeedProduct = {
  id: 'phone',
  name: 'Phone',
  description: 'Phone',
  price: 100,
  stock: 1,
  condition: null,
  variant_model: 'legacy',
  offers: [
    {
      id: 'used',
      condition: 'used',
      price: 50,
      images: [
        'https://cdn.example/used.avif',
        { url: 'https://cdn.example/back.avif' },
      ],
    },
  ],
};
const manifest: ImageManifestMap = {
  phone: [
    {
      verified_url: 'https://cdn.example/parent.jpg',
      status: 'verified',
      is_primary: true,
      position: 0,
      verified_format: 'jpeg',
    },
    {
      source_url: 'https://cdn.example/used.avif',
      verified_url: 'https://cdn.example/used.jpg',
      status: 'verified',
      is_primary: false,
      position: 1,
      verified_format: 'jpeg',
    },
    {
      source_url: 'https://cdn.example/back.avif',
      verified_url: 'https://cdn.example/back.jpg',
      status: 'verified',
      is_primary: false,
      position: 2,
      verified_format: 'jpeg',
    },
  ],
};
describe.each([
  ['Facebook', generateFacebookCatalogFeed],
  ['Google', generateGoogleMerchantFeed],
] as const)('%s offer images', (_name, build) => {
  const render = (images: ImageManifestMap) =>
    build(
      [product],
      { id: 'shop', slug: 'shop', business_name: 'Shop' },
      'https://example.com',
      images
    );
  it('uses verified offer-specific primary and additional images instead of parent images', () => {
    const xml = render(manifest);
    expect(xml).toContain(
      '<g:image_link>https://cdn.example/used.jpg</g:image_link>'
    );
    expect(xml).toContain(
      '<g:additional_image_link>https://cdn.example/back.jpg</g:additional_image_link>'
    );
    expect(xml).not.toContain('parent.jpg');
  });
  it('omits offers with unverified explicit images', () => {
    expect(render({ phone: [manifest.phone[0]] })).not.toContain('<item>');
  });
  it('retains verified offer imagery even without a parent primary image', () => {
    expect(render({ phone: manifest.phone.slice(1) })).toContain(
      '<g:id>used</g:id>'
    );
  });
});
