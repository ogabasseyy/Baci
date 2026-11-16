import { useState } from 'react';
import { PRODUCT_GRID_MAX_PRICE_LIMIT } from '@/constants/product-grid';

export function useProductGridFilters(
  initialViewMode: 'grid' | 'list' = 'grid'
) {
  const [selectedCategorySlug, setSelectedCategorySlug] = useState('all');
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(PRODUCT_GRID_MAX_PRICE_LIMIT);
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [selectedCondition, setSelectedCondition] = useState('All');
  const [minRating, setMinRating] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(initialViewMode);

  const handleCategorySelect = (categorySlug: string) => {
    setSelectedCategorySlug(categorySlug);
    setMinPrice(0);
    setMaxPrice(PRODUCT_GRID_MAX_PRICE_LIMIT);
    setSelectedBrand('All');
    setSelectedCondition('All');
    setMinRating(0);
  };

  const handlePriceChange = (min: number, max: number) => {
    setMinPrice(min);
    setMaxPrice(max);
  };

  return {
    handleCategorySelect,
    handlePriceChange,
    maxPrice,
    minPrice,
    minRating,
    selectedBrand,
    selectedCategorySlug,
    selectedCondition,
    setMinRating,
    setSelectedBrand,
    setSelectedCondition,
    setViewMode,
    viewMode,
  };
}
