'use client';

import type { ReactNode } from 'react';
import {
  recordSearchSubmission,
  type SearchSubmissionLinkSource,
} from '@/lib/search-submission';
import { truncateSearchSubmissionQuery } from '@/lib/search-submission-query';

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
      href={`${pathPrefix}/search?q=${encodeURIComponent(truncateSearchSubmissionQuery(query))}`}
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
