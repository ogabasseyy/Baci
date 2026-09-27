import { ThemedButton } from '@/components/themed';

interface ProductGridCategoryPillsProps {
  categories: string[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
}

/**
 * Category pill row for the storefront product grid (the default,
 * non-`showFilters` branch alongside the heading). Extracted from
 * StorefrontProductGrid (modularity boundary); markup and behavior are
 * unchanged.
 */
export function ProductGridCategoryPills({
  categories,
  selectedCategory,
  onSelectCategory,
}: ProductGridCategoryPillsProps) {
  if (categories.length <= 1) {
    return null;
  }

  return (
    <div className="flex justify-center gap-2 mb-8 flex-wrap">
      {categories.map((category) => (
        <ThemedButton
          key={category}
          type="button"
          aria-pressed={selectedCategory === category}
          variant={selectedCategory === category ? 'default' : 'outline'}
          colorRole={selectedCategory === category ? 'primary' : 'accent'}
          onClick={() => onSelectCategory(category)}
          size="sm"
          className="capitalize"
        >
          {category}
        </ThemedButton>
      ))}
    </div>
  );
}
