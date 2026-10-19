import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useStartSavingsProductSearch } from './use-start-savings-product-search';

const mockSearch = jest.fn();
const mockResolveProduct = jest.fn();
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: (input: unknown) => mockSearch(input),
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSearch.mockReturnValue({
    products: [],
    isLoading: false,
    resolveProduct: mockResolveProduct,
  });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('enables exact route product resolution without waiting for search text', () => {
  const { result } = renderHook(() =>
    useStartSavingsProductSearch({
      params: { productId: ['product-1'] },
      searchValue: '',
    })
  );
  expect(mockSearch).toHaveBeenCalledWith({
    enabled: true,
    limit: 8,
    search: undefined,
  });
  expect(result.current.resolveProduct).toBe(mockResolveProduct);
});

it('debounces search and disables it when the settled value is whitespace', () => {
  const { rerender } = renderHook<
    ReturnType<typeof useStartSavingsProductSearch>,
    { searchValue: string }
  >(
    ({ searchValue }) =>
      useStartSavingsProductSearch({ params: {}, searchValue }),
    { initialProps: { searchValue: '' } }
  );
  rerender({ searchValue: ' iphone ' });
  act(() => jest.advanceTimersByTime(299));
  expect(mockSearch).toHaveBeenLastCalledWith({
    enabled: false,
    limit: 8,
    search: undefined,
  });
  act(() => jest.advanceTimersByTime(1));
  expect(mockSearch).toHaveBeenLastCalledWith({
    enabled: true,
    limit: 8,
    search: 'iphone',
  });
  rerender({ searchValue: '   ' });
  act(() => jest.advanceTimersByTime(300));
  expect(mockSearch).toHaveBeenLastCalledWith({
    enabled: false,
    limit: 8,
    search: undefined,
  });
});
