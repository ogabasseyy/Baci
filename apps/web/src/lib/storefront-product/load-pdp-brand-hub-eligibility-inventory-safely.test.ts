import { beforeEach, describe, expect, it, vi } from 'vitest';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { resolveEligibleCategoryHubDestinations } from '@/lib/storefront-content/eligible-hub-destinations';
import { loadPdpBrandHubEligibilityInventorySafely as load } from './load-pdp-brand-hub-eligibility-inventory-safely';

const read = vi.fn();
vi.mock(
  '@/lib/storefront-category/get-cached-brand-authority-inventory',
  () => ({
    getCachedBrandAuthorityInventory: (...args: unknown[]) => read(...args),
    OPTIONAL_AUTHORITY_INVENTORY_MAX_PRODUCTS: 100,
  })
);
const input = {
  merchantId: 'merchant-1',
  categorySlug: 'smartphones',
  productBrand: 'Apple',
};
const rows = Array.from({ length: 5 }, (_, i) => ({
  id: `p-${i}`,
  slug: `iphone-${i}`,
  name: `iPhone 15 ${i}`,
  brand: 'Apple',
  price: 100,
  stock: 2,
  manage_stock: true,
}));
describe('PDP hub eligibility adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    read.mockResolvedValue({ products: rows });
  });
  it('requests a complete bounded shared inventory instead of a display limit or full scan', async () => {
    const products = await load(input);
    expect(read).toHaveBeenCalledWith(
      'merchant-1',
      'smartphones',
      expect.objectContaining({ brandKey: 'apple' }),
      { maxProducts: 100, timeoutMs: 1000 }
    );
    const destinations = resolveEligibleCategoryHubDestinations({
      categorySlug: input.categorySlug,
      products,
      assumeCategoryScoped: true,
    });
    expect(destinations.brandHubs).toHaveLength(1);
    expect(destinations.familyHubs).toHaveLength(1);
  });
  it.each([
    null,
    '',
    '  ',
    'unknown-brand',
  ])('does not read for unsupported brand %s', async (productBrand) => {
    expect(await load({ ...input, productBrand })).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
  it('omits links on incomplete, inactive-category, timeout or database failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const message of [
      'incomplete pool',
      'category unavailable',
      'timeout',
      'database unavailable',
    ]) {
      read.mockRejectedValueOnce(new Error(message));
      expect(await load(input)).toEqual([]);
    }
    warn.mockRestore();
  });
  it('uses the destination threshold and stock normalization, including string prices', async () => {
    read.mockResolvedValueOnce({
      products: rows.map((row, i) => ({
        ...row,
        price: '1,000',
        manage_stock: i !== 0,
        stock: i === 0 ? 0 : 2,
      })),
    });
    expect(await load(input)).toHaveLength(5);
    read.mockResolvedValueOnce({
      products: rows.map((row, i) => ({ ...row, stock: i === 0 ? 0 : 2 })),
    });
    expect(await load(input)).toEqual([]);
  });
  it('keeps specification metadata for hub candidates', async () => {
    read.mockResolvedValueOnce({
      products: rows.map((row) => ({
        ...row,
        product_key_specs: { chipset: 'A18' },
      })),
    });
    expect((await load(input))[0].product_key_specs).toMatchObject({
      chipset: 'A18',
    });
  });
  it('fails closed when taxonomy resolution throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi
      .spyOn(brandAuthorityTaxonomy, 'getEntries')
      .mockImplementation(() => {
        throw new Error('taxonomy unavailable');
      });
    expect(await load(input)).toEqual([]);
    spy.mockRestore();
    warn.mockRestore();
  });
});
