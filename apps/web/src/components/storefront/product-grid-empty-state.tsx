import type { ProductGridFilterType } from './product-grid-filters';

interface ProductGridEmptyStateProps {
  searchQuery: string | undefined;
  selectedCategory: string;
  filterType: ProductGridFilterType;
}

/**
 * Empty state for the storefront product grid. Extracted from
 * StorefrontProductGrid (modularity boundary); markup and behavior are
 * unchanged.
 */
export function ProductGridEmptyState({
  searchQuery,
  selectedCategory,
  filterType,
}: ProductGridEmptyStateProps) {
  return (
    <div className="text-center text-muted-foreground py-16">
      <h3 className="text-xl font-semibold">No products found</h3>
      <p>
        {searchQuery
          ? `Your search for "${searchQuery}" did not match any products.`
          : selectedCategory !== 'All'
            ? `No products found ${filterType === 'price' ? 'in this price range' : filterType === 'brand' ? 'for this brand' : 'in this category'}.`
            : 'No products are currently available.'}
      </p>
    </div>
  );
}
