import './ogabassey-pdp-semantic-sections.test-fixtures';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { OgabasseyPdpSemanticSections } from './ogabassey-pdp-semantic-sections';
import {
  mockBuildProductSemanticModel,
  mockGetCachedProductSeoLinkData,
  mockLoadPdpBrandHubEligibilityInventorySafely,
  mockProductSemanticSections,
  product,
} from './ogabassey-pdp-semantic-sections.test-fixtures';

describe('OgabasseyPdpSemanticSections stock resolution', () => {
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

  it('resolves positive stock when base pool stock_quantity is positive even if legacy stock is zero', async () => {
    const productWithStockQuantity = {
      ...product,
      manage_stock: true,
      stock: 0,
      stock_quantity: 12,
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
        product: productWithStockQuantity,
        productComparePathPrefix: '/ogabassey',
        storeSlug: 'ogabassey',
        storeUrl: 'https://ogabassey.com',
      })
    );

    expect(mockBuildProductSemanticModel).toHaveBeenCalledWith(
      expect.objectContaining({
        currentProduct: expect.objectContaining({ stock: 12 }),
      })
    );
  });
});
