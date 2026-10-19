import { describe, expect, it } from 'vitest';
import { buildStorefrontContentPageSchema } from './build-storefront-content-page-schema';

describe('buildStorefrontContentPageSchema', () => {
  it('omits dateModified when the merchant has no source timestamp', () => {
    const schema = buildStorefrontContentPageSchema({
      baseUrl: 'https://example.com',
      businessName: 'Example Store',
      description: 'Terms for Example Store.',
      pageName: 'Terms of Service',
      path: '/terms',
      updatedAt: null,
    });

    expect(schema).not.toHaveProperty('dateModified');
  });

  it('preserves a real merchant timestamp as dateModified', () => {
    const schema = buildStorefrontContentPageSchema({
      baseUrl: 'https://example.com',
      businessName: 'Example Store',
      description: 'Privacy Policy for Example Store.',
      pageName: 'Privacy Policy',
      path: '/privacy',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(schema.dateModified).toBe('2026-09-01T00:00:00.000Z');
  });
});
