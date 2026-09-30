import { Search, TrendingUp } from 'lucide-react';
import Image from 'next/image';
import { getProductUrl } from '@/lib/product-url';
import { cn } from '@/lib/utils';
import type {
  AutocompletePopularSearch,
  AutocompleteProduct,
} from './search-autocomplete-types';

interface SearchAutocompletePopupProps {
  canSubmitSearch: boolean;
  formatCurrencyCompact: (price: number) => string;
  hasResults: boolean;
  /**
   * True once the current query's fetch resolved successfully. Gates the
   * "No suggestions" message so it never appears during the debounce,
   * while loading, or after a failed request.
   */
  hasSuggestionsResponse: boolean;
  highlightedIndex: number;
  listboxId: string;
  loading: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onPopularSearchSelect?: (query: string) => void;
  onSelectProduct?: (url: string) => void;
  onSubmitSearch: (query: string) => void;
  popularSearches: AutocompletePopularSearch[];
  suggestions: AutocompleteProduct[];
  trimmedValue: string;
  value: string;
}

/**
 * The popup container is deliberately NOT the listbox: a listbox may only
 * own option/group children, so the "See all results" action and the
 * loading status render as siblings beside it.
 */
export function SearchAutocompletePopup({
  canSubmitSearch,
  formatCurrencyCompact,
  hasResults,
  hasSuggestionsResponse,
  highlightedIndex,
  listboxId,
  loading,
  onChange,
  onClose,
  onPopularSearchSelect,
  onSelectProduct,
  onSubmitSearch,
  popularSearches,
  suggestions,
  trimmedValue,
  value,
}: SearchAutocompletePopupProps) {
  return (
    <div className="absolute z-50 mt-2 w-full rounded-xl border border-gray-100 shadow-2xl bg-white text-gray-900 overflow-hidden ring-1 ring-black/5">
      {hasResults && (
        <div id={listboxId} role="listbox" aria-label="Search suggestions">
          <div className="max-h-[400px] overflow-y-auto py-2">
            {/* Product suggestions */}
            {suggestions.length > 0 && (
              // biome-ignore lint/a11y/useSemanticElements: role="group" is correct for listbox groups
              <div
                className="mb-2"
                role="group"
                aria-labelledby="products-group-label"
              >
                <div
                  id="products-group-label"
                  className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-400"
                >
                  Products
                </div>
                {suggestions.map((product, index) => (
                  <button
                    type="button"
                    key={product.id}
                    id={`search-option-${index}`}
                    role="option"
                    aria-selected={highlightedIndex === index}
                    onClick={() => {
                      onSelectProduct?.(getProductUrl(product));
                      onClose();
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors',
                      highlightedIndex === index
                        ? 'bg-red-50/80 text-gray-900'
                        : 'hover:bg-gray-50'
                    )}
                  >
                    {product.image_small ? (
                      <div className="relative size-10 shrink-0 overflow-hidden rounded bg-gray-100 border border-gray-100">
                        <Image
                          src={product.image_small}
                          alt=""
                          fill
                          sizes="40px"
                          className="object-cover"
                          aria-hidden="true"
                        />
                      </div>
                    ) : (
                      <div className="flex size-10 items-center justify-center rounded bg-gray-100 text-gray-400">
                        <Search size={16} />
                      </div>
                    )}
                    <div className="flex-1 overflow-hidden">
                      <div className="truncate font-semibold text-sm text-gray-900">
                        {product.name}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                        {(product.categories?.name || product.category) && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                            {product.categories?.name || product.category}
                          </span>
                        )}
                        <span className="font-bold text-red-600">
                          <span className="sr-only">Price: </span>
                          {formatCurrencyCompact(product.price)}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Popular searches */}
            {popularSearches.length > 0 && (
              // biome-ignore lint/a11y/useSemanticElements: role="group" is correct for listbox groups
              <div role="group" aria-labelledby="popular-searches-label">
                <div
                  id="popular-searches-label"
                  className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 border-t border-gray-50 mt-2"
                >
                  Popular searches
                </div>
                {popularSearches.map((search, index) => {
                  const optionIndex = suggestions.length + index;
                  return (
                    <button
                      type="button"
                      key={search.search_query}
                      id={`search-option-${optionIndex}`}
                      role="option"
                      aria-selected={highlightedIndex === optionIndex}
                      onClick={() => {
                        onChange(search.search_query);
                        // Match the keyboard path: submit-wired consumers
                        // navigate on activation, so pointer and touch users
                        // are not left on the current page with a closed
                        // popup. Consumers without submission report the
                        // explicit pick through onPopularSearchSelect so the
                        // activation is still tracked once.
                        if (canSubmitSearch) {
                          onSubmitSearch(search.search_query);
                        } else {
                          onPopularSearchSelect?.(search.search_query);
                        }
                        onClose();
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors',
                        highlightedIndex === optionIndex
                          ? 'bg-red-50/80 text-gray-900'
                          : 'hover:bg-gray-50'
                      )}
                    >
                      <div className="flex bg-gray-100 rounded-full p-1.5 text-gray-500">
                        <TrendingUp className="size-3.5" aria-hidden="true" />
                      </div>
                      <span className="flex-1 truncate text-sm font-medium text-gray-700">
                        {search.search_query}
                      </span>
                      {search.search_count > 10 && (
                        <span className="text-[10px] font-medium text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                          Trending
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {!hasResults && canSubmitSearch && hasSuggestionsResponse && (
        <p className="px-4 pt-3 text-sm text-gray-500">
          No suggestions for “{trimmedValue}”
        </p>
      )}
      {canSubmitSearch && (
        <button
          type="button"
          onClick={() => {
            onSubmitSearch(value);
            onClose();
          }}
          className="mt-1 flex w-full items-center justify-center gap-2 border-t border-store-border bg-store-secondary px-4 py-2.5 text-sm font-semibold text-store-primary transition-colors hover:bg-store-primary/10 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-store-primary"
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="truncate">See all results for “{trimmedValue}”</span>
        </button>
      )}
      {loading && (
        <div
          className="border-t border-gray-100 bg-gray-50 p-2 text-center text-xs font-medium text-gray-500"
          aria-live="polite"
        >
          Searching…
        </div>
      )}
    </div>
  );
}
