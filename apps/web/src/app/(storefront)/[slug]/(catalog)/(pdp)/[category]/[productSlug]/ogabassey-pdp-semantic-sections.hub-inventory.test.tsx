import './ogabassey-pdp-semantic-sections.test-fixtures';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OgabasseyPdpSemanticSections } from './ogabassey-pdp-semantic-sections';
import {
  mockBuildProductSemanticModel,
  mockGetCachedProductSeoLinkData,
  mockLoadPdpBrandHubEligibilityInventorySafely,
  mockProductSemanticSections,
  product,
} from './ogabassey-pdp-semantic-sections.test-fixtures';

describe('OgabasseyPdpSemanticSections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadPdpBrandHubEligibilityInventorySafely.mockResolvedValue([]);
    mockGetCachedProductSeoLinkData.mockResolvedValue({
      inventory: [
        {
          slug: 'macbook-pro',
          name: 'MacBook Pro',
          brand: 'Apple',
          price: 4500000,
          stock: 2,
          category_slug: 'laptops',
          product_key_specs: {
            chipset: 'Apple M4 Max',
            ram_gb: 18,
            storage_gb: 512,
          },
        },
      ],
      guidePosts: [
        { slug: 'lenovo-legion-guide', title: 'Lenovo Legion Guide' },
        { slug: 'best-laptops', title: 'Best laptops' },
      ],
      priorityGuidePostSlugs: ['lenovo-legion-guide'],
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

  it('renders existing semantic sections and compare links intact when loadPdpBrandHubEligibilityInventorySafely returns empty array', async () => {
    mockLoadPdpBrandHubEligibilityInventorySafely.mockResolvedValueOnce([]);

    render(
      await OgabasseyPdpSemanticSections({
        categoryName: 'Laptops',
        categorySlug: 'laptops',
        merchant: {
          id: 'merchant-1',
          business_name: 'OgaBassey',
          country: 'NG',
          payout_currency: 'NGN',
        },
        product,
        productComparePathPrefix: '/ogabassey',
        storeSlug: 'ogabassey',
        storeUrl: 'https://ogabassey.com',
      })
    );

    expect(screen.getByLabelText('semantic sections')).toHaveTextContent(
      'Model trust bullet'
    );
    expect(mockProductSemanticSections).toHaveBeenCalledWith(
      expect.objectContaining({
        productCompareLinks: [
          expect.objectContaining({
            href: '/laptops/compare/lenovo-legion-vs-macbook-pro',
          }),
        ],
      })
    );
    expect(mockBuildProductSemanticModel).toHaveBeenCalledWith(
      expect.objectContaining({
        hubEligibilityInventory: [],
      })
    );
  });

  it('forwards resolved hubEligibilityInventory to buildProductSemanticModel', async () => {
    const mockHubInventory = [
      {
        slug: 'lenovo-legion-7',
        name: 'Lenovo Legion 7',
        brand: 'Lenovo',
        price: 4000000,
        availability: 'InStock' as const,
        stock: 5,
        category_slug: 'laptops',
      },
    ];
    mockLoadPdpBrandHubEligibilityInventorySafely.mockResolvedValueOnce(
      mockHubInventory
    );

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
    });

    expect(mockBuildProductSemanticModel).toHaveBeenCalledWith(
      expect.objectContaining({
        hubEligibilityInventory: mockHubInventory,
      })
    );
  });
});
