export type ProductGridFilterType = 'category' | 'brand' | 'price';

interface ProductGridFiltersProps {
  filterType: ProductGridFilterType;
  filterOptions: string[];
  selectedCategory: string;
  onFilterTypeChange: (filterType: ProductGridFilterType) => void;
  onSelectCategory: (category: string) => void;
}

/**
 * Filter panel for the storefront product grid (the `showFilters` branch):
 * filter-type selector plus option pills. Extracted from
 * StorefrontProductGrid (modularity boundary); markup and behavior are
 * unchanged.
 */
export function ProductGridFilters({
  filterType,
  filterOptions,
  selectedCategory,
  onFilterTypeChange,
  onSelectCategory,
}: ProductGridFiltersProps) {
  return (
    <div className="w-full mb-6">
      <div className="bg-card border rounded-xl p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-start gap-6">
          <div className="flex items-center gap-3">
            <svg
              className="size-5 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
            <select
              className="text-base font-medium border-0 bg-transparent focus:ring-0 cursor-pointer pr-8"
              value={filterType}
              onChange={(e) => {
                onFilterTypeChange(e.target.value as ProductGridFilterType);
                onSelectCategory('All'); // Reset active filter when type changes
              }}
            >
              <option value="category">Shop by Category</option>
              <option value="brand">Shop by Brand</option>
              <option value="price">Shop by Price</option>
            </select>
          </div>
          {filterOptions.length > 0 ? (
            <div className="flex gap-2 flex-wrap">
              {filterOptions.map((option) => (
                <button
                  type="button"
                  key={option}
                  aria-pressed={selectedCategory === option}
                  onClick={() =>
                    onSelectCategory(
                      selectedCategory === option ? 'All' : option
                    )
                  }
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    selectedCategory === option
                      ? 'bg-store-primary text-store-primary-text shadow-md scale-105'
                      : 'bg-muted/50 hover:bg-muted text-foreground hover:shadow-sm'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground italic">
              No {filterType === 'category' ? 'categories' : 'brands'} found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
