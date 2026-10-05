'use client';
import {
  buildRefinedSearchHref,
  mergeAssistedRefinements,
  type SearchRefinements,
} from '@baci/shared/lib';
import { useSearchAssistance } from '@/hooks/use-search-assistance';
import { searchAssistanceRequestSchema } from '@/schemas/search-assistance';

export function AssistedSearchSuggestions({
  query,
  enabled,
  criteria,
  basePath,
}: {
  query: string;
  enabled: boolean;
  criteria: SearchRefinements;
  basePath: string;
}) {
  const assistance = useSearchAssistance(query, enabled);
  // The request schema rejects one-character, over-120-character, and
  // normalization-empty queries, so the action hides outside those bounds
  // instead of advertising a request that can only 400.
  if (
    !enabled ||
    !searchAssistanceRequestSchema.shape.query.safeParse(query).success
  )
    return null;
  let proposalHref: string | null = null;
  if (assistance.proposal) {
    try {
      proposalHref = buildRefinedSearchHref(
        basePath,
        assistance.proposal.query,
        mergeAssistedRefinements(criteria, assistance.proposal)
      );
    } catch {
      /* A conflicting proposal cannot replace the current filters. */
    }
  }
  return (
    <div className="mt-2 text-sm text-store-background-text">
      <button
        type="button"
        disabled={assistance.pending}
        onClick={() => void assistance.ask()}
        className="min-h-11 rounded-full border border-store-background-text/20 px-4"
      >
        {assistance.pending ? 'Thinking…' : 'Ask about this search'}
      </button>
      {assistance.error && <p role="alert">{assistance.error}</p>}
      {assistance.proposal && (
        <div>
          <p>{assistance.proposal.explanation}</p>
          {proposalHref ? (
            <a
              className="inline-flex min-h-11 items-center underline"
              href={proposalHref}
            >
              Apply search suggestions
            </a>
          ) : (
            <p role="alert">
              These suggestions conflict with your filters. Clear filters or
              keep searching.
            </p>
          )}
          <button
            type="button"
            className="ml-3 min-h-11 underline"
            onClick={assistance.dismiss}
          >
            Dismiss suggestions
          </button>
        </div>
      )}
    </div>
  );
}
