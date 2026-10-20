import { SEARCH_SORT_OPTIONS, type SearchRefinements } from '@baci/shared/lib';

interface SearchSortSelectProps {
  sort: SearchRefinements['sort'];
  pending: boolean;
  onSortChange: (sort: SearchRefinements['sort']) => void;
}

export function getSearchSortLabel(sort: SearchRefinements['sort']) {
  return SEARCH_SORT_OPTIONS.find((option) => option.value === sort)?.label;
}

export function SearchSortSelect({
  sort,
  pending,
  onSortChange,
}: SearchSortSelectProps) {
  const selectedSort = getSearchSortLabel(sort);
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 lg:mt-5">
      <p className="hidden text-sm lg:block">
        {pending ? 'Updating results…' : `Sort: ${selectedSort}`}
      </p>
      <label className="hidden lg:block">
        Sort by{' '}
        <select
          aria-label="Sort by"
          value={sort}
          onChange={(e) =>
            onSortChange(e.target.value as SearchRefinements['sort'])
          }
        >
          {SEARCH_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
