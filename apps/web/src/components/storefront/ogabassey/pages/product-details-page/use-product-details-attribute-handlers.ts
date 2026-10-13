'use client';

import type { Dispatch, SetStateAction } from 'react';
import { pruneSelectionsByVariantAvailability } from '@/components/storefront/ogabassey/variant-selection-pruning';
import type { NormalizedProductDetails } from './product-normalization';

interface UseProductDetailsAttributeHandlersOptions {
  formatAxisLabel: (axis: string) => string;
  handleColorSelection: (index: number) => void;
  productData: NormalizedProductDetails;
  setMissingFields: Dispatch<SetStateAction<string[]>>;
  setSelectedAttributes: Dispatch<SetStateAction<Record<string, string>>>;
}

export function useProductDetailsAttributeHandlers({
  formatAxisLabel,
  handleColorSelection,
  productData,
  setMissingFields,
  setSelectedAttributes,
}: UseProductDetailsAttributeHandlersOptions) {
  const handleAttributeSelection = (axis: string, value: string) => {
    setSelectedAttributes((prev) => {
      const next = { ...prev, [axis]: value };
      return pruneSelectionsByVariantAvailability(
        next,
        axis,
        productData.variants
      );
    });
  };

  const handleModalColorSelection = (index: number) => {
    handleColorSelection(index);
    setMissingFields((prev) => prev.filter((field) => field !== 'Color'));
  };

  const handleModalAttributeSelection = (axis: string, value: string) => {
    const label = formatAxisLabel(axis);
    setSelectedAttributes((prev) => {
      const next = { ...prev, [axis]: value };
      return pruneSelectionsByVariantAvailability(
        next,
        axis,
        productData.variants
      );
    });
    setMissingFields((prev) => prev.filter((field) => field !== label));
  };

  return {
    handleAttributeSelection,
    handleModalAttributeSelection,
    handleModalColorSelection,
  };
}
