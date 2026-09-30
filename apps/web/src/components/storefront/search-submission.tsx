'use client';

import {
  recordSearchSubmission,
  SEARCH_SUBMISSION_QUERY_MAX_LENGTH,
} from '@/lib/search-submission';

interface SearchSubmissionFormProps {
  pathPrefix: string;
  query: string;
}

/** Native GET navigation also works before hydration or with JavaScript disabled. */
export function SearchSubmissionForm({
  pathPrefix,
  query,
}: SearchSubmissionFormProps) {
  // Clamp the retained value to the shared limit so the displayed, navigated,
  // and recorded queries are always identical (sanitizeSearchQuery allows 200).
  const initialQuery = query.slice(0, SEARCH_SUBMISSION_QUERY_MAX_LENGTH);
  return (
    <form
      action={`${pathPrefix}/search`}
      method="get"
      className="mt-4 flex gap-2"
      onSubmit={(event) => {
        const value = new FormData(event.currentTarget).get('q');
        if (typeof value === 'string')
          recordSearchSubmission(value, pathPrefix, 'results-form');
      }}
    >
      <input
        type="search"
        name="q"
        aria-label="Search products"
        defaultValue={initialQuery}
        maxLength={SEARCH_SUBMISSION_QUERY_MAX_LENGTH}
        className="min-w-0 flex-1 rounded-md border border-store-background-text/15 bg-store-background px-3 py-2 text-store-background-text"
      />
      <button
        type="submit"
        className="rounded-md bg-store-primary px-4 py-2 text-store-primary-text"
      >
        Search
      </button>
    </form>
  );
}
