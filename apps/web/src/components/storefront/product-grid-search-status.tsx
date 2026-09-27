import { ThemedButton } from '@/components/themed';

interface ProductGridSearchStatusProps {
  searchError: string | null;
  debouncedSearchQuery: string | undefined;
  showPreviewFailure: boolean;
  onRetrySearch: () => void;
  isLoading: boolean;
  isSearching: boolean;
  resultCount: number;
  selectedCategory: string;
}

/**
 * Search-status presentation for the storefront product grid: the server
 * search error banner, the preview-index failure banner with retry, and
 * the screen-reader live region. Extracted from StorefrontProductGrid
 * (modularity boundary); markup and behavior are unchanged.
 */
export function ProductGridSearchStatus({
  searchError,
  debouncedSearchQuery,
  showPreviewFailure,
  onRetrySearch,
  isLoading,
  isSearching,
  resultCount,
  selectedCategory,
}: ProductGridSearchStatusProps) {
  return (
    <>
      {searchError && debouncedSearchQuery && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Search is temporarily unavailable. Showing the last available results.{' '}
          {searchError}
        </div>
      )}
      {showPreviewFailure && debouncedSearchQuery && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-store-accent bg-store-secondary px-4 py-3 text-sm text-store-secondary-text">
          <span>
            Preview search could not load, so showing all products instead.
          </span>
          <ThemedButton
            type="button"
            onClick={onRetrySearch}
            variant="outline"
            colorRole="accent"
            size="sm"
          >
            Retry search
          </ThemedButton>
        </div>
      )}
      {/* Live region for screen reader announcements */}
      <output className="sr-only" aria-live="polite">
        {isLoading || isSearching
          ? 'Loading products...'
          : `${resultCount} product${resultCount !== 1 ? 's' : ''} found${
              selectedCategory !== 'All' ? ` in ${selectedCategory}` : ''
            }`}
      </output>
    </>
  );
}
