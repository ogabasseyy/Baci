import { act, renderHook } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedProductDetails } from './product-normalization';
import { useProductDetailsAttributeHandlers } from './use-product-details-attribute-handlers';

vi.mock('@/components/storefront/ogabassey/variant-selection-pruning', () => ({
  pruneSelectionsByVariantAvailability: vi.fn(
    (next: Record<string, string>) => next
  ),
}));

import { pruneSelectionsByVariantAvailability } from '@/components/storefront/ogabassey/variant-selection-pruning';

const productData = {
  variants: [
    {
      id: 'v1',
      attributes: { storage: '256GB', color: 'Black' },
      condition: 'new' as const,
      price_modifier: 0,
      stock_quantity: 5,
    },
  ],
} as unknown as NormalizedProductDetails;

function createStateSetter<T>(
  getValue: () => T,
  setValue: (next: T) => void
): Dispatch<SetStateAction<T>> {
  return (value) => {
    setValue(
      typeof value === 'function'
        ? (value as (previous: T) => T)(getValue())
        : value
    );
  };
}

describe('useProductDetailsAttributeHandlers', () => {
  it('prunes sibling selections when a variant-backed axis changes', () => {
    const setSelectedAttributes = vi.fn(
      (updater: (prev: Record<string, string>) => Record<string, string>) =>
        updater({ storage: '256GB', color: 'Black' })
    ) as Dispatch<SetStateAction<Record<string, string>>>;

    const { result } = renderHook(() =>
      useProductDetailsAttributeHandlers({
        formatAxisLabel: (axis) => axis,
        handleColorSelection: vi.fn(),
        productData,
        setMissingFields: vi.fn(),
        setSelectedAttributes,
      })
    );

    act(() => {
      result.current.handleAttributeSelection('storage', '512GB');
    });

    expect(pruneSelectionsByVariantAvailability).toHaveBeenCalledWith(
      { storage: '512GB', color: 'Black' },
      'storage',
      productData.variants
    );
    expect(setSelectedAttributes).toHaveBeenCalledTimes(1);
  });

  it('clears the color validation error when a modal color is selected', () => {
    const handleColorSelection = vi.fn();
    let missingFields = ['Color', 'Storage'];
    const setMissingFields = createStateSetter(
      () => missingFields,
      (next) => {
        missingFields = next;
      }
    );

    const { result } = renderHook(() =>
      useProductDetailsAttributeHandlers({
        formatAxisLabel: (axis) => axis,
        handleColorSelection,
        productData,
        setMissingFields,
        setSelectedAttributes: vi.fn(),
      })
    );

    act(() => {
      result.current.handleModalColorSelection(1);
    });

    expect(handleColorSelection).toHaveBeenCalledWith(1);
    expect(missingFields).toEqual(['Storage']);
  });

  it('updates attributes and clears the matching modal field label', () => {
    let selectedAttributes: Record<string, string> = {};
    const setSelectedAttributes = createStateSetter(
      () => selectedAttributes,
      (next) => {
        selectedAttributes = next;
      }
    );
    let missingFields = ['Storage'];
    const setMissingFields = createStateSetter(
      () => missingFields,
      (next) => {
        missingFields = next;
      }
    );

    const { result } = renderHook(() =>
      useProductDetailsAttributeHandlers({
        formatAxisLabel: () => 'Storage',
        handleColorSelection: vi.fn(),
        productData,
        setMissingFields,
        setSelectedAttributes,
      })
    );

    act(() => {
      result.current.handleModalAttributeSelection('storage', '256GB');
    });

    expect(selectedAttributes).toEqual({ storage: '256GB' });
    expect(missingFields).toEqual([]);
  });

  it('prunes incompatible sibling selections from modal attribute changes', () => {
    vi.mocked(pruneSelectionsByVariantAvailability).mockReturnValueOnce({
      storage: '512GB',
    });

    let selectedAttributes: Record<string, string> = {
      storage: '256GB',
      color: 'Silver',
    };
    const setSelectedAttributes: Dispatch<SetStateAction<Record<string, string>>> =
      createStateSetter(
        () => selectedAttributes,
        (next) => {
          selectedAttributes = next;
        }
      );

    const { result } = renderHook(() =>
      useProductDetailsAttributeHandlers({
        formatAxisLabel: () => 'Storage',
        handleColorSelection: vi.fn(),
        productData,
        setMissingFields: vi.fn(),
        setSelectedAttributes,
      })
    );

    act(() => {
      result.current.handleModalAttributeSelection('storage', '512GB');
    });

    expect(pruneSelectionsByVariantAvailability).toHaveBeenCalledWith(
      { storage: '512GB', color: 'Silver' },
      'storage',
      productData.variants
    );
    expect(selectedAttributes).toEqual({ storage: '512GB' });
  });
});
