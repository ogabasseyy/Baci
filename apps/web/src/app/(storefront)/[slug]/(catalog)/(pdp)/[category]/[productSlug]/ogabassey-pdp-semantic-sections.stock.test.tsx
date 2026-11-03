import './ogabassey-pdp-semantic-sections.test-fixtures';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { buildProductHref } from '@/lib/storefront-product/build-product-semantic-compare-support';
import type { ProductSemanticCandidate } from '@/lib/storefront-product/product-semantic-types';
import { OgabasseyPdpSemanticSections } from './ogabassey-pdp-semantic-sections';
import {
  mockBuildProductSemanticModel,
  mockGetCachedProductSeoLinkData,
  mockLoadPdpBrandHubEligibilityInventorySafely,
  mockProductSemanticSections,
  product,
} from './ogabassey-pdp-semantic-sections.test-fixtures';

describe('OgabasseyPdpSemanticSections stock and category normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadPdpBrandHubEligibilityInventorySafely.mockResolvedValue([]);
    mockGetCachedProductSeoLinkData.mockResolvedValue({
      inventory: [],
      guidePosts: [],
      priorityGuidePostSlugs: [],
    });
    mockBuildProductSemanticModel.mockReturnValue({
      trustBullets: ['Model trust bullet'],
      supportLinks: [],
      guideLinks: [],
      alternatives: null,
      sameBrand: null,
      samePrice: null,
    });
  });

  it('resolves unmanaged product (manage_stock: false, stock: 0) as stock: null and confirms checkout availability copy', async () => {
    const unmanagedProduct = {
      ...product,
      manage_stock: false,
      stock: 0,
      stock_quantity: 0,
    } as Product;

    render(
      await OgabasseyPdpSemanticSections({
        categoryName: 'Laptops',
        categorySlug: 'laptops',
        merchant: {
          id: 'merchant-1',
          business_name: 'OgaBassey',
          country: 'NG',
          payout_currency: 'USD',
          feature_settings: { blog_enabled: true },
        },
        product: unmanagedProduct,
        productComparePathPrefix: '/ogabassey',
        storeSlug: 'ogabassey',
        storeUrl: 'https://ogabassey.com',
      })
    );

    expect(mockBuildProductSemanticModel).toHaveBeenCalledWith(
      expect.objectContaining({
        currentProduct: expect.objectContaining({ stock: null }),
      })
    );

    expect(mockProductSemanticSections).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          contextParagraphs: expect.arrayContaining([
            expect.stringContaining(
              'Live stock, selected options and delivery timing should still be confirmed at checkout.'
            ),
          ]),
        }),
      })
    );

    const callArgs = mockProductSemanticSections.mock.calls[0]?.[0];
    const firstParagraph = callArgs?.model?.contextParagraphs?.[0] ?? '';
    expect(firstParagraph).not.toContain('out of stock');
  });

  it('normalizes candidate category_slug to requested parent categorySlug so child-category candidates are retained', async () => {
    mockGetCachedProductSeoLinkData.mockResolvedValueOnce({
      inventory: [
        {
          slug: 'gaming-laptop-1',
          name: 'Gaming Laptop 1',
          brand: 'Lenovo',
          price: 2000000,
          stock: 2,
          category_slug: 'gaming-laptops',
        },
      ],
      guidePosts: [],
      priorityGuidePostSlugs: [],
    });

    const childCategoryProduct = {
      ...product,
      category_slug: 'gaming-laptops',
    } as Product;

    await OgabasseyPdpSemanticSections({
      categoryName: 'Laptops',
      categorySlug: 'laptops',
      merchant: {
        id: 'merchant-1',
        business_name: 'OgaBassey',
      },
      product: childCategoryProduct,
      productComparePathPrefix: '/ogabassey',
      storeSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
    });

    expect(mockBuildProductSemanticModel).toHaveBeenCalledWith(
      expect.objectContaining({
        categorySlug: 'laptops',
        currentProduct: expect.objectContaining({
          category_slug: 'laptops',
        }),
        inventory: [
          expect.objectContaining({
            slug: 'gaming-laptop-1',
            category_slug: 'laptops',
            canonical_category_slug: 'gaming-laptops',
          }),
        ],
      })
    );

    const firstCallInput = mockBuildProductSemanticModel.mock.calls[0]?.[0] as
      | { inventory?: ProductSemanticCandidate[] }
      | undefined;
    const inventoryPassed = firstCallInput?.inventory ?? [];
    const candidate = inventoryPassed.find((p) => p.slug === 'gaming-laptop-1');
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected candidate to be defined');
    // Preserves canonical child URL so cards do not emit duplicate parent URLs
    expect(buildProductHref('https://ogabassey.com', candidate)).toBe(
      'https://ogabassey.com/gaming-laptops/gaming-laptop-1'
    );
  });

  it('preserves candidate original category_slug for buildCompareLinkGraph so child-category comparisons are not approved for the parent route', async () => {
    mockGetCachedProductSeoLinkData.mockResolvedValueOnce({
      inventory: [
        {
          slug: 'gaming-laptop-1',
          name: 'Gaming Laptop 1',
          brand: 'Lenovo',
          price: 2000000,
          stock: 2,
          category_slug: 'gaming-laptops',
          product_key_specs: { ram_gb: 16, storage_gb: 512, cpu: 'i7' },
        },
      ],
      guidePosts: [],
      priorityGuidePostSlugs: [],
    });

    render(
      await OgabasseyPdpSemanticSections({
        categoryName: 'Laptops',
        categorySlug: 'laptops',
        merchant: {
          id: 'merchant-1',
          business_name: 'OgaBassey',
        },
        product,
        productComparePathPrefix: '/ogabassey',
        storeSlug: 'ogabassey',
        storeUrl: 'https://ogabassey.com',
      })
    );

    // Because gaming-laptop-1 retains category_slug: 'gaming-laptops' in compareInventory,
    // buildCompareLinkGraph filters it out when categorySlug is 'laptops'
    expect(mockProductSemanticSections).toHaveBeenCalledWith(
      expect.objectContaining({
        productCompareLinks: [],
      })
    );
  });
});
