'use client';

// Client boundary justified: the submit handler must intercept
// sanitized-empty queries before the GET navigation fires.
import { type FormEvent, useState } from 'react';
import { recordSearchSubmission } from '@/lib/search-submission';
import {
  parseStorefrontSearchQueryParam,
  STOREFRONT_SEARCH_MAX_QUERY_LENGTH,
} from '@/lib/storefront-search-params';

interface SearchPageFormProps {
  action: string;
  defaultQuery: string;
  pathPrefix: string;
}

export function SearchPageForm({
  action,
  defaultQuery,
  pathPrefix,
}: SearchPageFormProps) {
  const [error, setError] = useState<string | null>(null);

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
    // An explicit re-search: record it while the native GET navigation
    // proceeds. Never blocks or alters the navigation.
    if (typeof raw === 'string') {
      recordSearchSubmission(raw, pathPrefix, 'results-form');
    }
  };

  // The owner keys this form by the route query: client-side navigation
  // (did-you-mean links, the persistent navbar) remounts the whole form,
  // resetting both the uncontrolled input (defaultValue alone would keep
  // showing the previous query) and any validation error. A key here
  // would NOT reset this component's own state.
  return (
    <div className="mt-6 max-w-xl">
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
          defaultValue={defaultQuery}
          placeholder="Search products…"
          maxLength={STOREFRONT_SEARCH_MAX_QUERY_LENGTH}
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : 'search-page-error'}
          onChange={() => setError(null)}
          className="min-w-0 flex-1 rounded-xl border border-store-background-text/15 bg-store-background px-4 py-2.5 text-sm text-store-background-text placeholder:text-store-background-text/40 focus:border-store-primary focus:outline-hidden"
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-store-primary px-4 py-2.5 text-sm font-semibold text-store-primary-text transition hover:opacity-90"
        >
          Search
        </button>
      </form>
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
