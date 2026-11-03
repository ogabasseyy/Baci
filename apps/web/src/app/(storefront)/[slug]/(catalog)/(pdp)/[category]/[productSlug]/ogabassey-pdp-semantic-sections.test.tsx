import './ogabassey-pdp-semantic-sections.test-fixtures';
import { render, screen } from '@testing-library/react';
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
      timeoutMs: 1_000,
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
