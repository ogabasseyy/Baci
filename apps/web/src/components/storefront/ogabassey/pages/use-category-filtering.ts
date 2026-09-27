import { useState } from 'react';
import type { FilterState } from '../components/CategoryFiltersSidebar';
import type { Product } from '../types';

const INITIAL_FILTER_STATE: FilterState = {
  brand: [],
  condition: [],
  storage: [],
  ram: [],
  graphics: [],
  colors: [],
  simType: [],
  displayType: [],
  displaySize: [],
  minPrice: 0,
  maxPrice: 0,
};

function buildAvailableFilterOptions(categoryProducts: Product[]) {
  const options = {
    brand: new Set<string>(),
    condition: new Set<string>(),
    storage: new Set<string>(),
    ram: new Set<string>(),
    graphics: new Set<string>(),
    colors: new Set<string>(),
    simType: new Set<string>(),
    displayType: new Set<string>(),
    displaySize: new Set<string>(),
  };

  categoryProducts.forEach((p) => {
    if (p.brand) options.brand.add(p.brand);
    if (p.condition) options.condition.add(p.condition);
    if (p.storage) {
      if (Array.isArray(p.storage)) {
        p.storage.forEach((s) => options.storage.add(s));
      } else {
        // Fallback if loose typing allows string
        options.storage.add(p.storage as unknown as string);
      }
    }
    if (p.ram) options.ram.add(p.ram);
    if (p.graphics) options.graphics.add(p.graphics);
    if (p.colors) p.colors.forEach((c) => {
      const colorName = typeof c === 'string' ? c : c.name;
      options.colors.add(colorName);
    });
    if (p.simType) options.simType.add(p.simType);
    if (p.displayType) options.displayType.add(p.displayType);
    if (p.displaySize) options.displaySize.add(p.displaySize);
  });

  return {
    brand: Array.from(options.brand).sort(),
    condition: Array.from(options.condition).sort(),
    storage: Array.from(options.storage).sort(),
    ram: Array.from(options.ram).sort(),
    graphics: Array.from(options.graphics).sort(),
    colors: Array.from(options.colors).sort(),
    simType: Array.from(options.simType).sort(),
    displayType: Array.from(options.displayType).sort(),
    displaySize: Array.from(options.displaySize).sort(),
  };
}

function applyProductFilters(
  categoryProducts: Product[],
  filters: FilterState
): Product[] {
  return categoryProducts.filter((p) => {
    // Price
    if (
      (p.rawPrice || 0) < filters.minPrice ||
      (filters.maxPrice > 0 && (p.rawPrice || 0) > filters.maxPrice)
    )
      return false;

    // Checkbox Filters (OR logic within category, AND logic between categories)
    if (
      filters.brand.length > 0 &&
      (!p.brand || !filters.brand.includes(p.brand))
    )
      return false;
    if (
      filters.condition.length > 0 &&
      (!p.condition || !filters.condition.includes(p.condition))
    )
      return false;
    if (
      filters.storage.length > 0 &&
      (!p.storage ||
        (Array.isArray(p.storage)
          ? !p.storage.some((s) => filters.storage.includes(s))
          : !filters.storage.includes(p.storage as unknown as string)))
    )
      return false;
    if (filters.ram.length > 0 && (!p.ram || !filters.ram.includes(p.ram)))
      return false;
    if (
      filters.graphics.length > 0 &&
      (!p.graphics || !filters.graphics.includes(p.graphics))
    )
      return false;
    if (
      filters.simType.length > 0 &&
      (!p.simType || !filters.simType.includes(p.simType))
    )
      return false;
    if (
      filters.displayType.length > 0 &&
      (!p.displayType || !filters.displayType.includes(p.displayType))
    )
      return false;
    if (
      filters.displaySize.length > 0 &&
      (!p.displaySize || !filters.displaySize.includes(p.displaySize))
    )
      return false;

    // Colors: If product has ANY of the selected colors
    if (filters.colors.length > 0) {
      if (!p.colors || !p.colors.some((c) => {
        const colorName = typeof c === 'string' ? c : c.name;
        return filters.colors.includes(colorName);
      }))
        return false;
    }

    return true;
  });
}

export function useCategoryFiltering(categoryProducts: Product[]) {
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTER_STATE);

  return {
    availableOptions: buildAvailableFilterOptions(categoryProducts),
    filteredProducts: applyProductFilters(categoryProducts, filters),
    filters,
    initialFilterState: INITIAL_FILTER_STATE,
    setFilters,
  };
}
