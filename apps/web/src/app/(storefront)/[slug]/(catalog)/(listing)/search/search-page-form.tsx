'use client';
import {
  buildRefinedSearchHref,
  resetRefinementsForQuery,
  type SearchRefinements,
  type SearchSuggestionProduct,
} from '@baci/shared/lib';

// Client boundary justified: the submit handler must intercept
// sanitized-empty queries before the GET navigation fires.
import { type FormEvent, useState } from 'react';
import { AssistedSearchSuggestions } from '@/components/storefront/search-refinements/assisted-search-suggestions';
import { useSearchQueryDraft } from '@/components/storefront/search-refinements/search-query-draft';
import { recordSearchSubmission } from '@/lib/search-submission';
import {
  parseStorefrontSearchQueryParam,
  STOREFRONT_SEARCH_MAX_QUERY_LENGTH,
} from '@/lib/storefront-search-params';
import { SearchAssistance } from './search-assistance';

interface SearchPageFormProps {
  action: string;
  defaultQuery: string;
  pathPrefix: string;
  refinements?: SearchRefinements;
  suggestionProducts?: SearchSuggestionProduct[];
  redOutline?: boolean;
  assistEnabled?: boolean;
}

export function SearchPageForm({
  action,
  defaultQuery,
  pathPrefix,
  refinements,
  suggestionProducts = [],
  redOutline = false,
  assistEnabled = false,
}: SearchPageFormProps) {
  const draft = useSearchQueryDraft();
  const [localQuery, setLocalQuery] = useState(defaultQuery);
  const query = draft?.query ?? localQuery;
  const setQuery = draft?.setQuery ?? setLocalQuery;
  const [focused, setFocused] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const error = draft ? draft.error : localError;
  const setError = draft?.setError ?? setLocalError;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    const raw = new FormData(event.currentTarget).get('q');
    // Same eligibility check as the navbar: a value made entirely of
    // whitespace or stripped characters would parse to an empty query on
    // the results route, so stay on the current results with feedback
    // instead of navigating away to the blank search-start state.
    if (!parseStorefrontSearchQueryParam(typeof raw === 'string' ? raw : '')) {
      event.preventDefault();
      setError('Enter a searchable term to update the results.');
      return;
    }
    // Record explicit submission before navigating; refinements are retained
    // only when the normalized query is unchanged.
    if (typeof raw === 'string') {
      recordSearchSubmission(raw, pathPrefix, 'results-form');
      if (refinements) {
        event.preventDefault();
        window.location.assign(
          buildRefinedSearchHref(
            action,
            parseStorefrontSearchQueryParam(raw),
            resetRefinementsForQuery(defaultQuery, raw, refinements)
          )
        );
      }
    }
  };

  // The owner keys this form by the route query: client-side navigation
  // (did-you-mean links, the persistent navbar) remounts the whole form,
  // resetting both the uncontrolled input (defaultValue alone would keep
  // showing the previous query) and any validation error. A key here
  // would NOT reset this component's own state.
  return (
    <div
      className="mt-6 max-w-xl"
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      <form
        method="get"
        action={action}
        aria-label="Edit search"
        onSubmit={handleSubmit}
        className="flex gap-2"
      >
        <label htmlFor="search-page-input" className="sr-only">
          Search products
        </label>
        <input
          id="search-page-input"
          name="q"
          type="search"
          value={query}
          placeholder="Search or ask a question…"
          maxLength={STOREFRONT_SEARCH_MAX_QUERY_LENGTH}
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : 'search-page-error'}
          onChange={(event) => {
            setQuery(event.target.value);
            setError(null);
          }}
          className={`min-w-0 flex-1 rounded-xl border-2 ${redOutline ? 'border-red-600 focus:border-red-600' : 'border-store-primary focus:border-store-primary'} bg-store-background px-4 py-2.5 text-sm text-store-background-text placeholder:text-store-background-text/40 focus:outline-hidden`}
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-store-primary px-4 py-2.5 text-sm font-semibold text-store-primary-text transition hover:opacity-90"
        >
          Search
        </button>
      </form>
      {focused && refinements && (
        <>
          <SearchAssistance
            query={query}
            resultQuery={defaultQuery}
            products={suggestionProducts}
            criteria={refinements}
            basePath={action}
          />
          <AssistedSearchSuggestions
            query={query}
            enabled={assistEnabled}
            criteria={refinements}
            basePath={action}
          />
        </>
      )}
      {error === null ? null : (
        <p
          id="search-page-error"
          role="alert"
          className="mt-2 text-sm text-store-background-text/70"
        >
          {error}
        </p>
      )}
    </div>
  );
}
