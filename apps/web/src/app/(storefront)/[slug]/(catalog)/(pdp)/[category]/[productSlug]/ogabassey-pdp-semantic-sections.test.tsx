import './ogabassey-pdp-semantic-sections.test-fixtures';
import { render, screen } from '@testing-library/react';
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

  it('builds semantic sections from deferred category inventory and guide posts', async () => {
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
        product,
        productComparePathPrefix: '/ogabassey',
        storeSlug: 'ogabassey',
        storeUrl: 'https://ogabassey.com',
      })
    );

    expect(mockGetCachedProductSeoLinkData).toHaveBeenCalledWith({
      blogEnabled: true,
      categorySlug: 'laptops',
      merchantId: 'merchant-1',
      productBrand: 'Lenovo',
      productId: 'prod-1',
      productName: 'Lenovo Legion',
      productSlug: 'lenovo-legion',
      storeSlug: 'ogabassey',
    });
    expect(mockLoadPdpBrandHubEligibilityInventorySafely).toHaveBeenCalledWith({
      categorySlug: 'laptops',
      merchantId: 'merchant-1',
      productBrand: 'Lenovo',
    });
    expect(mockBuildProductSemanticModel).toHaveBeenCalledWith(
      expect.objectContaining({
        categorySlug: 'laptops',
        currentProduct: expect.objectContaining({ slug: 'lenovo-legion' }),
        guidePosts: [
          { slug: 'lenovo-legion-guide', title: 'Lenovo Legion Guide' },
          { slug: 'best-laptops', title: 'Best laptops' },
        ],
        priorityGuidePostSlugs: ['lenovo-legion-guide'],
        inventory: [
          expect.objectContaining({
            slug: 'macbook-pro',
            category_slug: 'laptops',
          }),
        ],
        hubEligibilityInventory: [],
        storeUrl: 'https://ogabassey.com',
      })
    );
    // Trust bullets ("Buying context") were removed from the PDP; the model is
    // passed through as built, with no merchant-trust-bullet merge.
    expect(screen.getByLabelText('semantic sections')).toHaveTextContent(
      'Model trust bullet'
    );
    expect(screen.getByLabelText('semantic sections')).toHaveTextContent(
      'Lenovo Legion is listed by OgaBassey in Laptops'
    );
    expect(screen.getByLabelText('semantic sections').textContent).toMatch(
      /US\$3,500,000|\$3,500,000/
    );
    expect(screen.getByLabelText('semantic sections')).not.toHaveTextContent(
      '₦3,500,000'
    );
    expect(mockProductSemanticSections).toHaveBeenCalledWith({
      model: expect.objectContaining({
        contextParagraphs: expect.arrayContaining([
          expect.stringContaining(
            'Lenovo Legion is listed by OgaBassey in Laptops'
          ),
        ]),
      }),
      merchantName: 'OgaBassey',
      productCompareLinks: [
        expect.objectContaining({
          href: '/laptops/compare/lenovo-legion-vs-macbook-pro',
        }),
      ],
      productComparePathPrefix: '/ogabassey',
      productName: 'Lenovo Legion',
    });
  });

  it('returns no semantic sections when the strict server fetch fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Suppress expected warning noise for this server-side fallback path.
    });
    mockGetCachedProductSeoLinkData.mockRejectedValueOnce(
      new Error('transient inventory failure')
    );

    const result = await OgabasseyPdpSemanticSections({
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

    expect(result).toBeNull();
    expect(mockBuildProductSemanticModel).not.toHaveBeenCalled();
    expect(mockProductSemanticSections).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to load Ogabassey PDP semantic links',
      expect.objectContaining({
        categorySlug: 'laptops',
        merchantId: 'merchant-1',
        productId: 'prod-1',
      })
    );

    warnSpy.mockRestore();
  });

  it('passes the display name to the guide prefilter when a legacy slug differs', async () => {
    const legacyProduct = {
      ...product,
      slug: 'legacy-item-42',
      name: 'Lenovo Legion 5 Pro',
    } as Product;

    await OgabasseyPdpSemanticSections({
      categoryName: 'Laptops',
      categorySlug: 'laptops',
      merchant: {
        id: 'merchant-1',
        business_name: 'OgaBassey',
        feature_settings: { blog_enabled: true },
      },
      product: legacyProduct,
      productComparePathPrefix: '/ogabassey',
      storeSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
    });

    expect(mockGetCachedProductSeoLinkData).toHaveBeenCalledWith({
      blogEnabled: true,
      categorySlug: 'laptops',
      merchantId: 'merchant-1',
      productBrand: 'Lenovo',
      productId: 'prod-1',
      productName: 'Lenovo Legion 5 Pro',
      productSlug: 'legacy-item-42',
      storeSlug: 'ogabassey',
    });
  });
});
