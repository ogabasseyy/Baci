import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { Product } from '@/types/product';
import type { useLocalSavingsDrafts } from './use-local-savings-drafts';
import { useLocalStartSavingsForm } from './use-local-start-savings-form';

const product: Product = {
  id: 'phone',
  name: 'Phone',
  slug: 'phone',
  image: '',
  price: 100,
  has_variants: true,
  variants: [
    {
      id: 'variant',
      name: '256GB',
      price: 125,
      attributes: { storage: '256GB' },
    },
  ],
};
const mockRefetch = jest.fn(async () => undefined);
const mockDetail = {
  product: product as Product | null,
  isLoading: false,
  error: null as string | null,
  refetch: mockRefetch,
};
const mockCatalogue = {
  products: [] as Product[],
  isLoading: false,
  isError: false,
  refetch: mockRefetch,
};
jest.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => mockCatalogue,
}));
jest.mock('@/hooks/use-product', () => ({ useProduct: () => mockDetail }));

function createModel(): ReturnType<typeof useLocalSavingsDrafts> {
  return {
    drafts: [],
    draft: null,
    busy: false,
    error: null,
    canStartNewDraft: false,
    canRetryCreation: false,
    reload: jest.fn(async () => undefined),
    close: jest.fn(),
    open: jest.fn(async () => undefined),
    create: jest.fn(async () => undefined),
    startNewDraft: jest.fn(async () => undefined),
    retryCreation: jest.fn(async () => undefined),
    accept: jest.fn(async () => undefined),
  };
}
beforeEach(() => {
  mockDetail.product = product;
  mockDetail.isLoading = false;
  mockDetail.error = null;
  mockCatalogue.products = [];
  mockRefetch.mockClear();
});

it('submits only the exact route-selected IDs even when the product is outside search results', () => {
  const model = createModel();
  const { result } = renderHook(() =>
    useLocalStartSavingsForm(model, {
      productId: product.id,
      variantId: 'variant',
    })
  );
  expect(result.current.controller.selectedProduct?.price).toBe(125);
  act(() => result.current.controller.handleContinue());
  expect(model.create).toHaveBeenCalledWith('phone', 'variant');
});

it.each([
  'missing',
  'unknown',
  'loading',
  'failed',
  'busy',
])('blocks %s exact selection without a legacy or draft submission', (state) => {
  const model = createModel();
  if (state === 'missing') mockDetail.product = { ...product, variants: [] };
  if (state === 'loading') mockDetail.isLoading = true;
  if (state === 'failed') mockDetail.error = 'Unavailable';
  if (state === 'busy') model.busy = true;
  const { result } = renderHook(() =>
    useLocalStartSavingsForm(model, {
      productId: product.id,
      variantId: state === 'unknown' ? 'other' : 'variant',
    })
  );
  act(() => result.current.controller.handleContinue());
  expect(model.create).not.toHaveBeenCalled();
});

it('clears the exact selection when searching for a different product', () => {
  const model = createModel();
  const { result } = renderHook(() =>
    useLocalStartSavingsForm(model, {
      productId: product.id,
      variantId: 'variant',
    })
  );
  act(() => result.current.controller.setSearchValue('another device'));
  expect(result.current.controller.selectedProduct).toBeNull();
  expect(result.current.controller.canContinue).toBe(false);
  act(() => result.current.controller.selectProduct(product, 'variant'));
  expect(result.current.controller.selectedProduct?.variantId).toBe('variant');
});

it('refreshes both catalogue and selected device alongside persisted drafts', async () => {
  const model = createModel();
  const { result } = renderHook(() => useLocalStartSavingsForm(model, {}));
  await act(async () => result.current.refresh());
  expect(mockRefetch).toHaveBeenCalledTimes(2);
  expect(model.reload).toHaveBeenCalledTimes(1);
});
