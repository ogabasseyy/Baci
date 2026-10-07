import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useState } from 'react';
import type { Product } from '@/types/product';
import { useStartSavingsProductSelection } from './use-start-savings-product-selection';

const product = {
  id: 'product-1',
  image: 'https://example.com/iphone.jpg',
  name: 'iPhone 13 Pro Max',
  price: 800000,
  slug: 'iphone-13-pro-max',
  variants: [
    {
      attributes: { storage: '128GB' },
      id: 'variant-128',
      name: '128GB',
      price: 750000,
    },
    {
      attributes: { storage: '256GB' },
      id: 'variant-256',
      name: '256GB',
      price: 850000,
    },
  ],
} satisfies Product;

describe('useStartSavingsProductSelection', () => {
  it.each([
    false,
    true,
  ])('preserves target provenance while the next route product loads (custom=%s)', (custom) => {
    const nextProduct = {
      ...product,
      id: 'product-2',
      price: 950000,
      variants: [],
    };
    const { result, rerender } = renderHook(
      ({ productId, products }: { productId: string; products: Product[] }) => {
        const [target, updateTarget] = useState('');
        const selection = useStartSavingsProductSelection({
          params: {
            productId,
            variantId: productId === product.id ? 'variant-128' : undefined,
          },
          products,
          setFormError,
          setSearchValue,
          setTargetAmount: updateTarget,
        });
        return { ...selection, target, updateTarget };
      },
      { initialProps: { productId: product.id, products: [product] } }
    );
    expect(result.current.target).toBe('750000');
    if (custom) act(() => result.current.updateTarget('123456'));
    rerender({ productId: nextProduct.id, products: [] });
    expect(result.current.selectedProduct).toBeNull();
    rerender({ productId: nextProduct.id, products: [nextProduct] });
    expect(result.current.target).toBe(custom ? '123456' : '950000');
  });
  const setFormError = jest.fn();
  const setSearchValue = jest.fn();
  const setTargetAmount = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not turn a deleted explicit variant into a base-price selection when all variants disappear', () => {
    const { result } = renderHook(() =>
      useStartSavingsProductSelection({
        params: { productId: product.id, variantId: 'deleted-variant' },
        products: [{ ...product, variants: [] }],
        setFormError,
        setSearchValue,
        setTargetAmount,
      })
    );
    expect(result.current.selectedProduct).toEqual(
      expect.objectContaining({
        requiresVariantSelection: true,
        variantId: null,
      })
    );
    const update = setTargetAmount.mock.calls[0][0] as (
      current: string
    ) => string;
    expect(update('')).toBe('');
  });

  it('does not replace a stale route variant with the sole remaining variant', () => {
    const remainingProduct = { ...product, variants: [product.variants[0]] };
    const { result } = renderHook(() =>
      useStartSavingsProductSelection({
        params: { productId: product.id, variantId: 'deleted-variant' },
        products: [remainingProduct],
        setFormError,
        setSearchValue,
        setTargetAmount,
      })
    );

    expect(result.current.selectedProduct).toEqual(
      expect.objectContaining({
        requiresVariantSelection: true,
        variantId: null,
      })
    );
  });

  it('reconciles route changes and matching catalog refreshes without clearing search-omitted selections', () => {
    const { result, rerender } = renderHook(
      ({ variantId, products }: { variantId: string; products: Product[] }) =>
        useStartSavingsProductSelection({
          params: { productId: product.id, variantId },
          products,
          setFormError,
          setSearchValue,
          setTargetAmount,
        }),
      { initialProps: { variantId: 'variant-128', products: [product] } }
    );
    rerender({ variantId: 'variant-256', products: [product] });
    expect(result.current.selectedProduct?.variantId).toBe('variant-256');
    const updated = {
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        price: 900000,
      })),
    };
    rerender({ variantId: 'variant-256', products: [updated] });
    expect(result.current.selectedProduct?.price).toBe(900000);
    rerender({ variantId: 'variant-256', products: [] });
    expect(result.current.selectedProduct?.price).toBe(900000);
    rerender({
      variantId: 'variant-256',
      products: [{ ...updated, variants: [] }],
    });
    expect(result.current.selectedProduct?.requiresVariantSelection).toBe(true);
  });

  it('does not preselect a route variant with an invalid target price', () => {
    const { result } = renderHook(() =>
      useStartSavingsProductSelection({
        params: { productId: product.id, variantId: 'variant-128' },
        products: [
          {
            ...product,
            variants: [{ ...product.variants[0], price: 0 }],
          },
        ],
        setFormError,
        setSearchValue,
        setTargetAmount,
      })
    );

    expect(result.current.selectedProduct).toEqual(
      expect.objectContaining({
        requiresVariantSelection: true,
        variantId: null,
      })
    );
  });

  it('does not keep a previous route variant when selecting another product', () => {
    const { result } = renderHook(() =>
      useStartSavingsProductSelection({
        params: { productId: 'other-product', variantId: 'stale-variant' },
        products: [product],
        setFormError,
        setSearchValue,
        setTargetAmount,
      })
    );

    act(() => {
      result.current.selectProduct(product);
    });

    expect(result.current.selectedProduct).toEqual(
      expect.objectContaining({
        requiresVariantSelection: true,
        variantId: null,
      })
    );
  });

  it('applies an explicit variant and replaces the previous variant price', () => {
    const { result } = renderHook(() =>
      useStartSavingsProductSelection({
        params: {},
        products: [product],
        setFormError,
        setSearchValue,
        setTargetAmount,
      })
    );

    act(() => {
      result.current.selectProduct(product, 'variant-128');
    });
    expect(result.current.selectedProduct).toEqual(
      expect.objectContaining({ price: 750000, variantId: 'variant-128' })
    );

    act(() => {
      result.current.selectProduct(product, 'variant-256');
    });
    expect(result.current.selectedProduct).toEqual(
      expect.objectContaining({
        price: 850000,
        requiresVariantSelection: false,
        variantId: 'variant-256',
      })
    );
  });
});

it('keeps a cached device non-actionable until current variants resolve', async () => {
  let finish: (value: Product) => void = () => {};
  const resolveProduct = jest.fn(
    () =>
      new Promise<Product>((resolve) => {
        finish = resolve;
      })
  );
  const preview: Product = {
    ...product,
    variants: undefined,
    price: 1,
    searchPreview: true,
  };
  const { result } = renderHook(() =>
    useStartSavingsProductSelection({
      params: {},
      products: [],
      resolveProduct,
      setFormError: jest.fn(),
      setSearchValue: jest.fn(),
    })
  );
  act(() => result.current.selectProduct(preview));
  expect(result.current.selectedProduct?.requiresVariantSelection).toBe(true);
  expect(result.current.selectedProduct?.price).toBe(0);
  await act(async () => finish(product));
  expect(result.current.selectedCatalogProduct?.searchPreview).toBeUndefined();
  expect(result.current.variantOptions).toHaveLength(2);
  act(() => result.current.selectVariant('variant-256'));
  expect(result.current.selectedProduct?.price).toBe(850000);
});

it('ignores an old detail response after the user clears their selection', async () => {
  let finish: (value: Product) => void = () => {};
  const resolveProduct = jest.fn(
    () =>
      new Promise<Product>((resolve) => {
        finish = resolve;
      })
  );
  const { result } = renderHook(() =>
    useStartSavingsProductSelection({
      params: {},
      products: [],
      resolveProduct,
      setFormError: jest.fn(),
      setSearchValue: jest.fn(),
    })
  );
  act(() =>
    result.current.selectProduct({
      ...product,
      variants: undefined,
      searchPreview: true,
    })
  );
  act(() => result.current.clearProductSelection());
  await act(async () => finish(product));
  expect(result.current.selectedProduct).toBeNull();
});

it('fails closed when a cached device cannot be revalidated', async () => {
  const setFormError = jest.fn();
  const resolveProduct = jest
    .fn<() => Promise<Product>>()
    .mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() =>
    useStartSavingsProductSelection({
      params: {},
      products: [],
      resolveProduct,
      setFormError,
      setSearchValue: jest.fn(),
    })
  );
  await act(async () =>
    result.current.selectProduct({
      ...product,
      variants: undefined,
      searchPreview: true,
    })
  );
  expect(result.current.selectedProduct).toBeNull();
  expect(setFormError).toHaveBeenLastCalledWith(
    expect.stringContaining('try again')
  );
});

it('does not overwrite newly verified variant prices with an older search result', async () => {
  const fresh = {
    ...product,
    variants: product.variants.map((variant) => ({
      ...variant,
      price: 900000,
    })),
  };
  const resolveProduct = jest
    .fn<() => Promise<Product>>()
    .mockResolvedValue(fresh);
  const { result } = renderHook(() =>
    useStartSavingsProductSelection({
      params: {},
      products: [product],
      resolveProduct,
      setFormError: jest.fn(),
      setSearchValue: jest.fn(),
    })
  );
  await act(async () =>
    result.current.selectProduct({
      ...product,
      variants: undefined,
      searchPreview: true,
    })
  );
  act(() => result.current.selectVariant('variant-256'));
  expect(result.current.selectedProduct?.price).toBe(900000);
});

it('discards a cached selection response when the route changes to a different device', async () => {
  let finish: (value: Product) => void = () => {};
  const resolveProduct = jest.fn(
    () =>
      new Promise<Product>((resolve) => {
        finish = resolve;
      })
  );
  const { result, rerender } = renderHook(
    (props: { productId: string }) =>
      useStartSavingsProductSelection({
        params: props,
        products: [],
        resolveProduct,
        setFormError: jest.fn(),
        setSearchValue: jest.fn(),
      }),
    { initialProps: { productId: '' } }
  );
  act(() =>
    result.current.selectProduct({
      ...product,
      variants: undefined,
      searchPreview: true,
    })
  );
  rerender({ productId: 'different-device' });
  await act(async () => finish(product));
  expect(result.current.selectedProduct).toBeNull();
});
