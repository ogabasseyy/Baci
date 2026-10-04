'use client';
import {
  buildCatalogSearchSuggestions,
  buildRefinedSearchHref,
  mergeAssistedRefinements,
  type SearchRefinements,
  type SearchSuggestionProduct,
} from '@baci/shared/lib';
export function SearchAssistance({
  query,
  resultQuery,
  products,
  criteria,
  basePath,
  currency,
}: {
  query: string;
  resultQuery: string;
  products: SearchSuggestionProduct[];
  criteria: SearchRefinements;
  basePath: string;
  currency: string;
}) {
  const suggestions = buildCatalogSearchSuggestions(
    query,
    resultQuery,
    products,
    {
      currency,
    }
  ).filter((suggestion) => {
    try {
      mergeAssistedRefinements(criteria, suggestion.proposal);
      return true;
    } catch {
      return false;
    }
  });
  if (!suggestions.length) return null;
  return (
    <fieldset
      aria-label="Search suggestions"
      className="mt-2 flex gap-2 overflow-x-auto pb-2"
    >
      {suggestions.map((suggestion) => (
        <a
          key={suggestion.label}
          href={buildRefinedSearchHref(
            basePath,
            suggestion.proposal.query,
            mergeAssistedRefinements(criteria, suggestion.proposal)
          )}
          className="flex min-h-11 shrink-0 items-center rounded-full border border-store-background-text/20 px-4 text-sm text-store-background-text"
        >
          {suggestion.label}
        </a>
      ))}
    </fieldset>
  );
}
