import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { Product } from '@/types/product';
import type { SavingsSearchParams } from './start-savings.types';
import { useStartSavingsController } from './use-start-savings-controller';

const product: Product = {
  id: 'product-1',
  name: 'Device',
  image: '',
  price: 100,
  slug: 'device',
  variants: [
    {
      id: 'variant-1',
      name: '128GB',
      attributes: { storage: '128GB' },
      price: 100,
    },
    {
      id: 'variant-2',
      name: '256GB',
      attributes: { storage: '256GB' },
      price: 120,
    },
  ],
};
let mockParams: SavingsSearchParams = {};
const mockProducts = jest.fn<
  (input: { limit: number; search?: string }) => {
    products: Product[];
    isLoading: boolean;
  }
>(() => ({ products: [product], isLoading: false }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: (input: never) => mockProducts(input),
}));
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({ data: null, refetch: jest.fn(), isRefetching: false }),
}));
const mockUseDebounce = jest.fn((value: string, _delay?: number) => value);
jest.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: string, delay: number) => mockUseDebounce(value, delay),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: { merchantId: string }) => unknown) =>
    select({ merchantId: 'merchant-1' }),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'ogabassey' },
}));
jest.mock('./use-start-savings-payment-methods', () => ({
  useStartSavingsPaymentMethods: () => ({ setPaymentMethodsError: jest.fn() }),
}));
jest.mock('./use-start-savings-submit', () => ({
  useStartSavingsSubmit: () => ({}),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

it('passes route product and variant into selection and exposes the resolved choice', () => {
  mockParams = { productId: [product.id], variantId: ['variant-2'] };
  const { result } = renderHook(() => useStartSavingsController());
  expect(mockProducts).toHaveBeenCalledWith({
    enabled: true,
    limit: 8,
    search: undefined,
  });
  expect(result.current.selectedCatalogProduct).toBe(product);
  expect(result.current.selectedProduct).toMatchObject({
    id: product.id,
    variantId: 'variant-2',
    requiresVariantSelection: false,
    price: 120,
  });
  expect(result.current.targetAmount).toBe('120');
  expect(result.current.searchValue).toBe(product.name);
  expect(result.current.variantOptions.map((option) => option.id)).toEqual([
    'variant-1',
    'variant-2',
  ]);
});

it('exposes product and variant callbacks that update selection, search and target state', () => {
  const { result } = renderHook(() => useStartSavingsController());
  expect(result.current.selectedProduct).toBeNull();
  expect(result.current.selectedCatalogProduct).toBeNull();
  expect(result.current.variantOptions).toEqual([]);
  act(() => result.current.selectProduct(product));
  expect(result.current.selectedProduct?.requiresVariantSelection).toBe(true);
  expect(result.current.targetAmount).toBe('');
  act(() => result.current.selectVariant('variant-1'));
  expect(result.current.selectedProduct?.variantId).toBe('variant-1');
  expect(result.current.targetAmount).toBe('100');
  expect(result.current.searchValue).toBe(product.name);
});

it('keeps a stale route variant unresolved and blocks preview', () => {
  mockParams = { productId: product.id, variantId: 'deleted-variant' };
  const { result } = renderHook(() => useStartSavingsController());
  act(() => result.current.handleContinue());
  expect(result.current.selectedProduct).toMatchObject({
    requiresVariantSelection: true,
    variantId: null,
  });
  expect(result.current.formError).toBe(
    'Select the exact device variant you want to save for.'
  );
  expect(result.current.showPreviewModal).toBe(false);
});

it('ignores a custom route target and uses the exact device price', () => {
  mockParams = {
    productId: product.id,
    variantId: 'variant-2',
    targetAmount: '999999',
  };
  const { result } = renderHook(() => useStartSavingsController());
  expect(result.current.targetValue).toBe(120);
  act(() => result.current.selectVariant('variant-1'));
  expect(result.current.targetValue).toBe(100);
});

it('debounces keystrokes before querying the product catalogue', () => {
  const { result } = renderHook(() => useStartSavingsController());

  act(() => result.current.setSearchValue('iph'));

  // 300ms like storefront search; the debounced (not raw) value drives
  // the uncancelled per-string catalogue query.
  expect(mockUseDebounce).toHaveBeenLastCalledWith('iph', 300);
  expect(mockProducts).toHaveBeenLastCalledWith({
    enabled: true,
    limit: 8,
    search: 'iph',
  });
  expect(result.current.debouncedSearch).toBe('iph');
});
