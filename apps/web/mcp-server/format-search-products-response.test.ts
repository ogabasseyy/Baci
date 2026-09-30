import { describe, expect, it, vi } from 'vitest';
import { formatSearchProductsResponse } from './format-search-products-response';

const selectedProducts = [{
  product: {
    id: 'laptop-1',
    name: 'Baci Laptop',
    slug: 'baci-laptop',
    images: [{ url: 'https://cdn.ogabassey.com/products/laptop.webp' }],
    condition: 'new',
    available_conditions: ['new'],
    has_condition_offers: false,
    brand: 'Baci',
    category: 'Laptops',
    updated_at: '2026-09-29T10:00:00.000Z',
  },
  displayPrice: 125000,
  displayCondition: 'new',
  displayCompareAtPrice: 150000,
  stockSummary: { inStock: true, level: 'Last Units', confidence: 'low' },
  availableVariants: [
    { attributes: { color: 'Black', storage: '256GB' } },
    { attributes: { color: 'Silver', storage: '256GB' } },
  ],
  selectedOption: { kind: 'variant', option_id: 'variant-1', attributes: { storage_gb: 256 }, condition: 'new', price: 125000 },
}] as unknown as Parameters<typeof formatSearchProductsResponse>[0]['selectedProducts'];

describe('formatSearchProductsResponse', () => {
  it('discloses incomplete coverage even when no candidate matches', () => {
    const response = formatSearchProductsResponse({
      selectedProducts: [], sanitizedQuery: 'camera', coverage: 'partial',
      searchMode: 'structured', semanticUnavailable: false,
      requestedCondition: undefined, getSafeCatalogImageUrl: () => undefined,
    });
    expect(response.content[0].text).toContain('This is a partial selection; other products may match.');
    expect(response.structuredContent).toMatchObject({status: 'empty', coverage: 'partial'});
  });

  it('preserves the MCP text, structured product, coverage, and widget metadata contract', () => {
    const getSafeCatalogImageUrl = vi.fn((url: string | null | undefined) => url ? `https://mcp.example/images?url=${encodeURIComponent(url)}` : undefined);
    const response = formatSearchProductsResponse({
      selectedProducts,
      sanitizedQuery: 'Baci laptop',
      coverage: 'partial',
      searchMode: 'structured',
      semanticUnavailable: true,
      requestedCondition: undefined,
      getSafeCatalogImageUrl,
    });

    expect(response.content).toEqual([{
      type: 'text',
      text: [
        'Found 1 Ogabassey products. Prices are listed in NGN; confirm availability before checkout.',
        'This is a partial selection; other products may match.',
        'Baci Laptop — ₦125,000 (Last Units); color: Black, Silver | storage: 256GB.',
      ].join('\n'),
    }]);
    expect(response.structuredContent).toEqual({
      status: 'success',
      products: [{
        id: 'laptop-1',
        name: 'Baci Laptop',
        slug: 'baci-laptop',
        price: 125000,
        compare_at_price: 150000,
        image: 'https://mcp.example/images?url=https%3A%2F%2Fcdn.ogabassey.com%2Fproducts%2Flaptop.webp',
        condition: 'new',
        brand: 'Baci',
        category: 'Laptops',
        in_stock: true,
        stock_level: 'Last Units',
        stock_confidence: 'low',
        price_status: 'discounted',
        matched_option: { kind: 'variant', option_id: 'variant-1', attributes: { storage_gb: 256 }, condition: 'new', price: 125000 },
        available_variants: 'color: Black, Silver | storage: 256GB',
        last_updated: '2026-09-29T10:00:00.000Z',
      }],
      coverage: 'partial',
      search_mode: 'structured',
      semantic_unavailable: true,
      meta: { total: 1, query: 'Baci laptop' },
    });
    expect(response._meta).toEqual({
      'openai/outputTemplate': expect.any(String),
      'openai/widgetPrefersBorder': true,
    });
    expect(getSafeCatalogImageUrl).toHaveBeenCalledWith('https://cdn.ogabassey.com/products/laptop.webp');
  });

  it('formats empty result text and status while retaining coverage', () => {
    const response = formatSearchProductsResponse({
      selectedProducts: [],
      sanitizedQuery: undefined,
      coverage: 'complete',
      searchMode: 'structured',
      semanticUnavailable: undefined,
      requestedCondition: 'used',
      getSafeCatalogImageUrl: () => undefined,
    });

    expect(response).toEqual({
      content: [{ type: 'text', text: 'No clear catalog match for "your criteria". Specify a product type, brand, or model and try again.' }],
      structuredContent: { products: [], status: 'empty', coverage: 'complete' },
    });
  });
});
