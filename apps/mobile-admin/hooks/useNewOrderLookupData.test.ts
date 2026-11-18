// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useCustomers: vi.fn(),
  useDebounce: vi.fn(),
  useProductPicker: vi.fn(),
  useProductPickerVariants: vi.fn(),
}));

vi.mock('@/hooks/useCustomers', () => ({
  useCustomers: mocks.useCustomers,
}));

vi.mock('@/hooks/useDebounce', () => ({
  useDebounce: mocks.useDebounce,
}));

vi.mock('@/hooks/useProductPicker', () => ({
  useProductPicker: mocks.useProductPicker,
}));

vi.mock('@/hooks/useProductPickerVariants', () => ({
  useProductPickerVariants: mocks.useProductPickerVariants,
}));

import { useNewOrderLookupData } from './useNewOrderLookupData';

describe('useNewOrderLookupData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useDebounce.mockImplementation((value) => value);
    mocks.useProductPicker.mockReturnValue({ products: [] });
    mocks.useProductPickerVariants.mockReturnValue({ data: [] });
    mocks.useCustomers.mockReturnValue({
      data: { pages: [] },
      hasNextPage: false,
    });
  });

  it('wires the debounced customer search into useCustomers and returns the lookup bundle', () => {
    const selectedParentProduct = { id: 'product-1' };

    const { result } = renderHook(() =>
      useNewOrderLookupData({
        customerSearch: 'Ada',
        productSearch: 'phone',
        selectedParentProduct: selectedParentProduct as never,
      })
    );

    expect(mocks.useDebounce).toHaveBeenCalledWith('Ada', 300);
    expect(mocks.useCustomers).toHaveBeenCalledWith({
      search: 'Ada',
      sortBy: 'alpha',
    });
    expect(mocks.useProductPicker).toHaveBeenCalledWith('phone');
    expect(mocks.useProductPickerVariants).toHaveBeenCalledWith(
      selectedParentProduct
    );
    expect(result.current.customersData).toEqual({ pages: [] });
  });
});
