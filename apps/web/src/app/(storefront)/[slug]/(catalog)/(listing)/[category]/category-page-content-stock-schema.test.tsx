import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CategoryPageContent,
  mockGenerateCollectionPageSchema,
  mockGetMerchantByIdentifier,
  mockNormalizeCategoryPageProducts,
  resetCategoryPageContentMocks,
} from './category-page-content.test-utils';

describe('CategoryPageContent - stock schema availability', () => {
  beforeEach(() => {
    resetCategoryPageContentMocks();
  });

  it('renders InStock in CollectionPage JSON-LD schema for an unmanaged product with manage_stock: false and stock: 0', async () => {
    const { generateCollectionPageSchema } =
      await vi.importActual<typeof import('@/lib/seo-utils')>(
        '@/lib/seo-utils'
      );
    mockGenerateCollectionPageSchema.mockImplementation(
      generateCollectionPageSchema
    );

    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
    });
    mockNormalizeCategoryPageProducts.mockReturnValue([
      {
        id: 'unmanaged-1',
        name: 'Digital Gift Card',
        description: 'Unlimited gift card',
        price: '₦5,000',
        rawPrice: 5000,
        stock: 0,
        manage_stock: false,
        image: 'https://cdn.example.com/card.png',
        brand: 'GiftCo',
        category: 'Cards',
        category_slug: 'cards',
        slug: 'digital-gift-card',
        condition: 'new',
      },
    ]);

    const { container } = render(
      await CategoryPageContent({
        params: Promise.resolve({ slug: 'demo-store', category: 'cards' }),
        searchParams: Promise.resolve({ page: '1' }),
      })
    );

    expect(mockGenerateCollectionPageSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [
          expect.objectContaining({
            manage_stock: false,
            stock: 0,
          }),
        ],
      })
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const collectionScript = Array.from(schemaScripts).find((s) =>
      s.textContent?.includes('"@type":"CollectionPage"')
    );
    expect(collectionScript?.textContent).toContain(
      'https://schema.org/InStock'
    );
    expect(collectionScript?.textContent).not.toContain(
      'https://schema.org/OutOfStock'
    );
  });

  it('renders OutOfStock in CollectionPage JSON-LD schema for a tracked product with manage_stock: true and stock: 0', async () => {
    const { generateCollectionPageSchema } =
      await vi.importActual<typeof import('@/lib/seo-utils')>(
        '@/lib/seo-utils'
      );
    mockGenerateCollectionPageSchema.mockImplementation(
      generateCollectionPageSchema
    );

    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
    });
    mockNormalizeCategoryPageProducts.mockReturnValue([
      {
        id: 'tracked-sold-out-1',
        name: 'Sold Out Phone',
        description: 'Tracked physical phone',
        price: '₦100,000',
        rawPrice: 100000,
        stock: 0,
        manage_stock: true,
        image: 'https://cdn.example.com/phone.png',
        brand: 'TechBrand',
        category: 'Phones',
        category_slug: 'phones',
        slug: 'sold-out-phone',
        condition: 'new',
      },
    ]);

    const { container } = render(
      await CategoryPageContent({
        params: Promise.resolve({ slug: 'demo-store', category: 'phones' }),
        searchParams: Promise.resolve({ page: '1' }),
      })
    );

    expect(mockGenerateCollectionPageSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [
          expect.objectContaining({
            manage_stock: true,
            stock: 0,
          }),
        ],
      })
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const collectionScript = Array.from(schemaScripts).find((s) =>
      s.textContent?.includes('"@type":"CollectionPage"')
    );
    expect(collectionScript?.textContent).toContain(
      'https://schema.org/OutOfStock'
    );
  });
});
