'use client';
import {
  emptySearchRefinements,
  SEARCH_SORT_OPTIONS,
  type SearchRefinements,
} from '@baci/shared/lib';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  createRefinementDraft,
  type RefinementDraft,
  SearchRefinementFields,
} from './search-refinement-fields';

interface Props {
  currency?: string;
  processors?: string[];
  conditions?: NonNullable<SearchRefinements['condition']>[];
  restoreFocus: () => void;
  panel: 'filters' | 'sort' | null;
  setPanel: (panel: 'filters' | 'sort' | null) => void;
  focusGroup: string;
  criteria: SearchRefinements;
  commit: (next: SearchRefinements) => void;
  draft: RefinementDraft;
  setDraft: (draft: RefinementDraft) => void;
  error: string | null;
  setError: (error: string | null) => void;
  brands: string[];
  categories: { id: string; name: string }[];
  apply: (draft: RefinementDraft) => void;
}
export function SearchRefinementSheet({
  currency,
  restoreFocus,
  panel,
  setPanel,
  focusGroup,
  criteria,
  commit,
  draft,
  setDraft,
  error,
  setError,
  brands,
  categories,
  processors,
  conditions,
  apply,
}: Props) {
  return (
    <Sheet
      open={panel !== null}
      onOpenChange={(value) => {
        if (!value) setPanel(null);
      }}
    >
      <SheetContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
        side="bottom"
        className={`${panel === 'filters' ? 'h-[72dvh]' : 'max-h-[72dvh]'} flex flex-col bg-store-background text-store-background-text`}
        onOpenAutoFocus={() => {
          if (panel === 'filters')
            requestAnimationFrame(() =>
              document
                .querySelector(
                  `[role="dialog"] [data-filter-group="${focusGroup}"]`
                )
                ?.scrollIntoView?.({ block: 'start' })
            );
        }}
      >
        <SheetTitle>{panel === 'sort' ? 'Sort results' : 'Filters'}</SheetTitle>
        <SheetDescription>
          {panel === 'sort'
            ? 'Choose how to order these results.'
            : 'Options for current results. Changes apply together when you select Apply filters.'}
        </SheetDescription>
        <button
          type="button"
          className="min-h-11 self-start underline"
          aria-label={panel === 'sort' ? 'Close sort' : 'Close filters'}
          onClick={() => setPanel(null)}
        >
          Close
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {panel === 'sort' ? (
            SEARCH_SORT_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex min-h-12 items-center gap-3"
              >
                <input
                  type="radio"
                  name="search-sort"
                  value={option.value}
                  checked={criteria.sort === option.value}
                  onChange={() => commit({ ...criteria, sort: option.value })}
                />
                {option.label}
              </label>
            ))
          ) : (
            <SearchRefinementFields
              currency={currency}
              draft={draft}
              onChange={(next) => {
                setDraft(next);
                setError(null);
              }}
              brands={brands}
              categories={categories}
              conditions={conditions}
              processors={processors}
              focusGroup={focusGroup}
            />
          )}
        </div>
        {panel === 'filters' && (
          <div className="shrink-0 pb-[env(safe-area-inset-bottom)]">
            {error && <p role="alert">{error}</p>}
            <div className="flex gap-4">
              <button
                type="button"
                className="min-h-12 px-4 underline"
                onClick={() => {
                  setDraft(
                    createRefinementDraft({
                      ...emptySearchRefinements(),
                      sort: criteria.sort,
                    })
                  );
                  setError(null);
                }}
              >
                Clear
              </button>
              <button
                type="button"
                className="min-h-12 flex-1 rounded-lg bg-store-primary px-4 text-store-primary-text"
                onClick={() => apply(draft)}
              >
                Apply filters
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
