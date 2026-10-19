import { orderRecordsByIds } from '@baci/shared/lib';
import type Fuse from 'fuse.js';
import { useCurrency } from '@/hooks/use-currency';
import { sortCategories } from '@/lib/category-sorting';
import type { Product } from '@/lib/products';
import type { ProductGridFilterType } from './product-grid-filters';

interface UseProductGridDataOptions {
  products: Product[];
  filterType: ProductGridFilterType;
  selectedCategory: string;
  debouncedSearchQuery: string | undefined;
  serverSearchProductIds: string[];
  limit: number;
  isPreviewMode: boolean | undefined;
  fuse: Fuse<Product> | null;
  navigationCategories: Array<{ name?: string | null }> | undefined;
}

/**
 * Pure derivations for the storefront product grid: filter option lists,
 * category pills, and the final searched/filtered/sliced result list.
 * Extracted from StorefrontProductGrid (modularity boundary); logic is
 * unchanged — single-pass category extraction, server-order preservation,
 * and the preview null-index fallback all behave exactly as before.
 */
export function useProductGridData({
  products,
  filterType,
  selectedCategory,
  debouncedSearchQuery,
  serverSearchProductIds,
  limit,
  isPreviewMode,
  fuse,
  navigationCategories,
}: UseProductGridDataOptions) {
  const { formatCurrencyCompact } = useCurrency();

  const priceRanges = [
    { label: `Under ${formatCurrencyCompact(50)}`, min: 0, max: 50 },
    {
      label: `${formatCurrencyCompact(50)} - ${formatCurrencyCompact(100)}`,
      min: 50,
      max: 100,
    },
    {
      label: `${formatCurrencyCompact(100)} - ${formatCurrencyCompact(200)}`,
      min: 100,
      max: 200,
    },
    {
      label: `Over ${formatCurrencyCompact(200)}`,
      min: 200,
      max: Number.POSITIVE_INFINITY,
    },
  ];

  // Single-pass category extraction — reused by filterOptions and categories
  const uniqueCategories = (() => {
    const cats = new Set<string>();
    for (const p of products) {
      if (p.category) cats.add(p.category);
    }
    return Array.from(cats);
  })();

  const filterOptions = (() => {
    if (filterType === 'category') {
      return uniqueCategories;
    } else if (filterType === 'brand') {
      const brands = new Set<string>();
      for (const p of products) {
        if (p.brand) brands.add(p.brand);
      }
      return Array.from(brands);
    } else if (filterType === 'price') {
      return priceRanges.map((r) => r.label);
    }
    return [];
  })();

  const categories = (() => {
    const priorityList: string[] = [];
    if (navigationCategories) {
      for (const c of navigationCategories) {
        const name = c.name?.toLowerCase().trim();
        if (name) priorityList.push(name);
      }
    }

    const sorted = sortCategories({
      categories: uniqueCategories,
      priorityList,
    });

    return ['All', ...sorted];
  })();

  const searchResults = (() => {
    if (debouncedSearchQuery && !isPreviewMode) {
      let filtered = orderRecordsByIds(products, serverSearchProductIds);

      if (selectedCategory !== 'All') {
        if (filterType === 'category') {
          filtered = filtered.filter((p) => p.category === selectedCategory);
        } else if (filterType === 'brand') {
          filtered = filtered.filter((p) => p.brand === selectedCategory);
        } else if (filterType === 'price') {
          const range = priceRanges.find((r) => r.label === selectedCategory);
          if (range) {
            filtered = filtered.filter((p) => {
              const price = p.price || 0;
              if (range.max === Number.POSITIVE_INFINITY)
                return price > range.min;
              if (range.min === 0) return price < range.max;
              return price >= range.min && price <= range.max;
            });
          }
        }
      }

      return filtered.slice(0, limit);
    }

    let filtered = products;

    if (debouncedSearchQuery && fuse && isPreviewMode) {
      filtered = fuse.search(debouncedSearchQuery).map((result) => result.item);
    }

    if (selectedCategory !== 'All') {
      if (filterType === 'category') {
        filtered = filtered.filter((p) => p.category === selectedCategory);
      } else if (filterType === 'brand') {
        filtered = filtered.filter((p) => p.brand === selectedCategory);
      } else if (filterType === 'price') {
        const range = priceRanges.find((r) => r.label === selectedCategory);
        if (range) {
          filtered = filtered.filter((p) => {
            const price = p.price || 0;
            if (range.max === Number.POSITIVE_INFINITY)
              return price > range.min;
            if (range.min === 0) return price < range.max;
            return price >= range.min && price <= range.max;
          });
        }
      }
    }

    return filtered.filter((p) => p.status === 'active').slice(0, limit);
  })();

  return { categories, filterOptions, searchResults };
}
