'use client';

import type { ReactNode } from 'react';
import { recordSearchSubmission } from '@/lib/search-submission';

interface SearchProps {
  pathPrefix: string;
  query: string;
}

/** Native GET navigation also works before hydration or with JavaScript disabled. */
export function SearchSubmissionForm({ pathPrefix, query }: SearchProps) {
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
        defaultValue={query}
        maxLength={100}
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

/** A plain anchor has no framework prefetch; only activation records a submission. */
export function SearchSubmissionLink({
  pathPrefix,
  query,
  source,
  children,
  className,
}: SearchProps & {
  source: 'see-all' | 'did-you-mean';
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={`${pathPrefix}/search?q=${encodeURIComponent(query.trim().slice(0, 100))}`}
      className={className}
      onClick={() => recordSearchSubmission(query, pathPrefix, source)}
      onAuxClick={(event) => {
        if (event.button === 1)
          recordSearchSubmission(query, pathPrefix, source);
      }}
    >
      {children}
    </a>
  );
}
