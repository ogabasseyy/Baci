import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCategoryPageDataSafely } from './load-category-page-data-safely';
import { verifyPriceBandLinkAgainstDestination } from './verify-price-band-link-against-destination';

vi.mock('./load-category-page-data-safely', () => ({
  loadCategoryPageDataSafely: vi.fn(),
}));

const mockLoad = vi.mocked(loadCategoryPageDataSafely);

const links = [
  { href: 'https://store.test/smartphones/compare/a-vs-b', label: 'A vs B' },
  {
    href: 'https://store.test/smartphones/best-under/under-500k',
    label: 'Best Smartphones Under ₦500,000',
  },
];

function rawProduct(id: string, brand: string, price: number) {
  return {
    id,
    slug: id,
    name: id,
    brand,
    price,
    category_slug: 'smartphones',
    stock_quantity: 4,
  };
}

describe('verifyPriceBandLinkAgainstDestination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('keeps the band link when the destination pool makes it indexable', async () => {
    const products = [
      ...Array.from({ length: 3 }, (_, i) =>
        rawProduct(`apple-${i}`, 'Apple', 300_000)
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        rawProduct(`samsung-${i}`, 'Samsung', 320_000)
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        rawProduct(`tecno-${i}`, 'Tecno', 340_000)
      ),
    ];
    mockLoad.mockResolvedValue({ isCollection: false, products } as never);
    const result = await verifyPriceBandLinkAgainstDestination({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      storeSlug: 'store',
      links,
    });
    expect(result).toEqual(links);
  });

  it('drops the band link when the destination pool is below thresholds', async () => {
    mockLoad.mockResolvedValue({
      isCollection: false,
      products: [rawProduct('only-1', 'Apple', 300_000)],
    } as never);
    const result = await verifyPriceBandLinkAgainstDestination({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      storeSlug: 'store',
      links,
    });
    expect(result).toEqual([links[0]]);
  });

  it('passes links through when there is no band link', async () => {
    const result = await verifyPriceBandLinkAgainstDestination({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      storeSlug: 'store',
      links: [links[0] as never],
    });
    expect(result).toEqual([links[0]]);
    expect(mockLoad).not.toHaveBeenCalled();
  });
});
