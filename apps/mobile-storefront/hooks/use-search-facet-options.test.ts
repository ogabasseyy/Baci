import { renderHook } from '@testing-library/react-native';
import { useSearchFacetOptions } from './use-search-facet-options';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
jest.mock('./product-utils', () => ({ CONSTANT_MERCHANT_ID: 'merchant-1' }));
jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => options,
}));
const facets = {
  brands: ['Apple'],
  categories: [],
  conditions: ['used'],
  minPrice: 100,
  maxPrice: 200,
};
function options(query: string, enabled = true, categoryId?: string) {
  const { result } = renderHook(() =>
    useSearchFacetOptions(query, enabled, categoryId)
  );
  return result.current as unknown as {
    queryKey: string[];
    enabled: boolean;
    placeholderData?: unknown;
    queryFn: () => Promise<unknown>;
  };
}
beforeEach(() => mockRpc.mockReset());
it('requests complete facets for the current query without reusing previous query data', async () => {
  mockRpc.mockResolvedValue({ data: facets, error: null });
  const config = options('iphone');
  expect(config.queryKey).toEqual([
    'search-available-facets',
    'merchant-1',
    'iphone',
  ]);
  expect(config.placeholderData).toBeUndefined();
  expect(await config.queryFn()).toEqual(facets);
  expect(mockRpc).toHaveBeenCalledWith(
    'get_storefront_search_available_facets',
    { search_query: 'iphone', merchant_id_param: 'merchant-1' }
  );
  expect(options('samsung').queryKey).not.toEqual(config.queryKey);
  expect(options('', false).enabled).toBe(false);
});
it.each([
  { data: null, error: { message: 'database' } },
  { data: { brands: ['Fake'] }, error: null },
])('fails safely for RPC errors or malformed facets', async (response) => {
  mockRpc.mockResolvedValue(response);
  await expect(options('iphone').queryFn()).rejects.toThrow(
    'Available filters couldn’t load.'
  );
});

it('adapts facets to category without reusing another category cache', async () => {
  mockRpc.mockResolvedValue({
    data: { ...facets, processors: ['Intel Core i7'] },
    error: null,
  });
  const category = options('laptop', true, 'gaming-category');
  expect(category.queryKey).toContain('gaming-category');
  await category.queryFn();
  expect(mockRpc).toHaveBeenCalledWith(
    'get_storefront_search_category_facets',
    {
      search_query: 'laptop',
      merchant_id_param: 'merchant-1',
      category_id_param: 'gaming-category',
    }
  );
});
