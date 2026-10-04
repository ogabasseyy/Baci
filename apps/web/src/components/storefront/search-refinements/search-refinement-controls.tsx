'use client';
import {
  buildRefinedSearchHref,
  emptySearchRefinements,
  getSearchQuickFilterGroups,
  getSearchRefinementChips,
  type SearchRefinements,
} from '@baci/shared/lib';
import { ArrowDownUp, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { asRoute } from '@/lib/routes';
import { getSearchCurrencyFormatter } from './search-currency';
import { useSearchQueryDraft } from './search-query-draft';
import {
  createRefinementDraft,
  parseRefinementDraft,
  type RefinementDraft,
  SearchRefinementFields,
} from './search-refinement-fields';
import { SearchRefinementSheet } from './search-refinement-sheet';
import { getSearchSortLabel, SearchSortSelect } from './search-sort-select';
import { SearchToolbarReveal } from './search-toolbar-reveal';
import { useDesktopRefinementDraft } from './use-desktop-refinement-draft';

interface Props {
  currency?: string;
  processors?: string[];
  conditions?: NonNullable<SearchRefinements['condition']>[];
  children?: ReactNode;
  query: string;
  basePath: string;
  criteria: SearchRefinements;
  brands: string[];
  categories: { id: string; name: string }[];
  facetError?: boolean;
  invalidFilters?: boolean;
}
export function SearchRefinementControls({
  currency = 'NGN',
  query,
  basePath,
  criteria,
  brands,
  categories,
  processors = [],
  conditions,
  facetError,
  invalidFilters,
  children,
}: Props) {
  const queryDraft = useSearchQueryDraft();
  const trigger = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [panel, setPanel] = useState<'filters' | 'sort' | null>(null);
  const [focusGroup, setFocusGroup] = useState('price');
  const [draft, setDraft] = useState(() => createRefinementDraft(criteria));
  const [error, setError] = useState<string | null>(null);
  const { desktopDraft, setDesktopDraft } = useDesktopRefinementDraft(
    criteria,
    () => {
      setPanel(null);
      setError(null);
    }
  );
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1024px)');
    const close = () => setPanel(null);
    media?.addEventListener('change', close);
    return () => {
      media?.removeEventListener('change', close);
    };
  }, []);
  const commit = (next: SearchRefinements) => {
    setPanel(null);
    setError(null);
    if (
      buildRefinedSearchHref(basePath, query, next) ===
        buildRefinedSearchHref(basePath, query, criteria) &&
      !invalidFilters
    )
      return;
    queryDraft?.reset();
    startTransition(() =>
      router.push(asRoute(buildRefinedSearchHref(basePath, query, next)))
    );
  };
  const open = (group: string) => {
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setDraft(createRefinementDraft(criteria));
    setError(null);
    setFocusGroup(group);
    setPanel('filters');
  };
  const apply = (value: RefinementDraft) => {
    const result = parseRefinementDraft(value);
    if (!result.success) {
      setError(result.error);
      return;
    }
    commit(result.data);
  };
  const clear = () => {
    setDesktopDraft(
      createRefinementDraft({
        ...emptySearchRefinements(),
        sort: criteria.sort,
      })
    );
    commit({ ...emptySearchRefinements(), sort: criteria.sort });
  };
  const desktopChange = (next: RefinementDraft, priceEdit?: boolean) => {
    setDesktopDraft(next);
    setError(null);
    if (!priceEdit) {
      commit({
        ...criteria,
        brands: [...next.brands].sort(),
        categoryId: next.categoryId,
        condition: next.condition,
        processor: next.processor,
        minRating: next.minRating,
      });
    }
  };
  const chips = getSearchRefinementChips(
    criteria,
    categories,
    getSearchCurrencyFormatter(currency).format
  );

  return (
    <div aria-busy={pending}>
      <SearchToolbarReveal
        pinned={panel !== null || !!facetError || !!invalidFilters}
      >
        <div className="mt-2 flex w-full max-w-full gap-2 overflow-x-auto pb-1 lg:hidden">
          {getSearchQuickFilterGroups(criteria, categories, processors).map(
            ({ label, key, active }) => (
              <button
                className={`flex min-h-10 min-w-28 shrink-0 grow basis-0 items-center justify-center gap-1.5 rounded-full border bg-store-background-text/5 px-2.5 text-sm ${active ? 'border-store-primary text-store-primary' : 'border-transparent'}`}
                aria-label={label}
                aria-haspopup="dialog"
                aria-expanded={panel === 'filters' && focusGroup === key}
                type="button"
                key={label}
                onClick={() => open(key)}
              >
                {label}
                {label === 'Brand' && criteria.brands.length
                  ? ` (${criteria.brands.length})`
                  : ''}
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            )
          )}
        </div>
        <div
          role="toolbar"
          aria-label="Sort and filter results"
          className="mt-2 flex rounded-xl bg-store-background-text/5 p-0.5 lg:hidden"
        >
          <button
            type="button"
            aria-label="Sort"
            className="flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 px-3"
            onClick={() => {
              trigger.current =
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null;
              setPanel('sort');
            }}
          >
            <ArrowDownUp size={18} aria-hidden="true" />
            <span className="truncate text-sm font-medium">
              {getSearchSortLabel(criteria.sort)}
            </span>
          </button>
          <button
            type="button"
            aria-label="Filters"
            className="flex min-h-12 flex-1 items-center justify-center gap-2 border-l border-store-background-text/15 px-3"
            onClick={() => open('price')}
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
            Filters{chips.length ? ` (${chips.length})` : ''}
          </button>
        </div>
        <SearchSortSelect
          sort={criteria.sort}
          pending={pending}
          onSortChange={(sort) => commit({ ...criteria, sort })}
        />
        {(chips.length > 0 || invalidFilters) && (
          <fieldset
            aria-label="Applied filters"
            className="my-3 flex flex-wrap items-center gap-2"
          >
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                aria-label={`Remove ${chip.label} filter`}
                className="min-h-11 rounded-full bg-store-background-text/10 px-3"
                onClick={() => {
                  if (chip.key === 'price')
                    setDesktopDraft({
                      ...desktopDraft,
                      minimum: '',
                      maximum: '',
                    });
                  commit(chip.next);
                }}
              >
                {chip.label} ×
              </button>
            ))}
            {(chips.length > 0 || invalidFilters) && (
              <button
                type="button"
                className="min-h-11 underline"
                onClick={clear}
              >
                Clear filters
              </button>
            )}
          </fieldset>
        )}
        {facetError && (
          <p role="status">
            Filter options couldn’t load.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => router.refresh()}
            >
              Retry filters
            </button>
          </p>
        )}
      </SearchToolbarReveal>
      <div className="flex gap-6">
        <aside
          aria-label="Search filters"
          className="hidden space-y-3 rounded-xl border border-store-background-text/10 p-4 lg:block lg:w-64 lg:shrink-0"
        >
          <SearchRefinementFields
            currency={currency}
            draft={desktopDraft}
            onChange={desktopChange}
            brands={brands}
            categories={categories}
            conditions={conditions}
            processors={processors}
            onPriceApply={() => apply(desktopDraft)}
          />
          {error && panel === null && <p role="alert">{error}</p>}
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      <SearchRefinementSheet
        restoreFocus={() => trigger.current?.focus()}
        {...{
          panel,
          currency,
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
          conditions,
          processors,
          apply,
        }}
      />
    </div>
  );
}
