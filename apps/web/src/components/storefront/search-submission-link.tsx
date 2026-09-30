'use client';

import type { ReactNode } from 'react';
import {
  recordSearchSubmission,
  SEARCH_SUBMISSION_QUERY_MAX_LENGTH,
  type SearchSubmissionLinkSource,
} from '@/lib/search-submission';

interface SearchSubmissionLinkProps {
  pathPrefix: string;
  query: string;
  source: SearchSubmissionLinkSource;
  children: ReactNode;
  className?: string;
}

/** A plain anchor has no framework prefetch; only activation records a submission. */
export function SearchSubmissionLink({
  pathPrefix,
  query,
  source,
  children,
  className,
}: SearchSubmissionLinkProps) {
  return (
    <a
      href={`${pathPrefix}/search?q=${encodeURIComponent(query.trim().slice(0, SEARCH_SUBMISSION_QUERY_MAX_LENGTH))}`}
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
