'use client';
import { createContext, type ReactNode, use, useState } from 'react';

interface SearchQueryDraft {
  query: string;
  error: string | null;
  setQuery: (query: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}
const DraftContext = createContext<SearchQueryDraft | null>(null);
export const useSearchQueryDraft = () => use(DraftContext);

/** Keeps the form and refinement navigation aligned with the committed query. */
export function SearchQueryDraftSession({
  initialQuery,
  children,
}: {
  initialQuery: string;
  children: ReactNode;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [error, setError] = useState<string | null>(null);
  return (
    <DraftContext
      value={{
        query,
        error,
        setQuery,
        setError,
        reset: () => {
          setQuery(initialQuery);
          setError(null);
        },
      }}
    >
      {children}
    </DraftContext>
  );
}
