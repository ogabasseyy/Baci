'use client';
import {
  parseSearchRefinements,
  type SearchRefinements,
} from '@baci/shared/lib';
import { type ReactNode, useState } from 'react';
import { getSearchCurrencyFormatter } from './search-currency';
export interface RefinementDraft
  extends Omit<SearchRefinements, 'minPrice' | 'maxPrice'> {
  minimum: string;
  maximum: string;
}
export const createRefinementDraft = (
  criteria: SearchRefinements
): RefinementDraft => ({
  ...criteria,
  minimum: criteria.minPrice?.toString() ?? '',
  maximum: criteria.maxPrice?.toString() ?? '',
});
export function parseRefinementDraft(draft: RefinementDraft) {
  return parseSearchRefinements({
    brand: draft.brands,
    category: draft.categoryId,
    condition: draft.condition,
    processor: draft.processor,
    minPrice: draft.minimum,
    maxPrice: draft.maximum,
    sort: draft.sort,
    minRating: draft.minRating?.toString(),
  });
}
export function SearchRefinementFields({
  currency = 'NGN',
  processors = [],
  focusGroup,
  conditions = ['new', 'used', 'open_box'],
  draft,
  onChange,
  brands,
  categories,
  onPriceApply,
}: {
  currency?: string;
  processors?: string[];
  focusGroup?: string;
  conditions?: NonNullable<SearchRefinements['condition']>[];
  draft: RefinementDraft;
  onChange: (next: RefinementDraft, priceEdit?: boolean) => void;
  brands: string[];
  categories: { id: string; name: string }[];
  onPriceApply?: () => void;
}) {
  const symbol =
    getSearchCurrencyFormatter(currency)
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? currency;
  const [expanded, setExpanded] = useState(focusGroup ?? '');
  const [brandQuery, setBrandQuery] = useState('');
  const visible = [...new Set([...brands, ...draft.brands])].filter((brand) =>
    brand.toLowerCase().includes(brandQuery.toLowerCase())
  );
  const inputClass =
    'min-h-11 w-full rounded-lg border border-store-background-text/20 bg-store-background px-3 py-2 text-store-background-text';
  return (
    <div className="space-y-6">
      <RefinementGroup
        group="category"
        title="Category"
        open={!focusGroup || expanded === 'category'}
        onToggle={
          focusGroup
            ? () => setExpanded(expanded === 'category' ? '' : 'category')
            : undefined
        }
      >
        <label>
          <span className="sr-only">Category</span>
          <select
            className={inputClass}
            value={draft.categoryId ?? ''}
            onChange={(e) =>
              onChange({ ...draft, categoryId: e.target.value || undefined })
            }
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
      </RefinementGroup>
      <RefinementGroup
        group="price"
        title="Price"
        open={!focusGroup || expanded === 'price'}
        onToggle={
          focusGroup
            ? () => setExpanded(expanded === 'price' ? '' : 'price')
            : undefined
        }
      >
        <div className="space-y-2">
          <label className="block text-sm">
            Minimum price ({symbol})
            <input
              className={inputClass}
              inputMode="decimal"
              value={draft.minimum}
              onChange={(e) =>
                onChange({ ...draft, minimum: e.target.value }, true)
              }
            />
          </label>
          <label className="block text-sm">
            Maximum price ({symbol})
            <input
              className={inputClass}
              inputMode="decimal"
              value={draft.maximum}
              onChange={(e) =>
                onChange({ ...draft, maximum: e.target.value }, true)
              }
            />
          </label>
          {onPriceApply && (
            <button
              type="button"
              className="min-h-11 text-store-primary underline"
              onClick={onPriceApply}
            >
              Apply price
            </button>
          )}
        </div>
      </RefinementGroup>
      <RefinementGroup
        group="brand"
        title="Brand"
        open={!focusGroup || expanded === 'brand'}
        onToggle={
          focusGroup
            ? () => setExpanded(expanded === 'brand' ? '' : 'brand')
            : undefined
        }
      >
        {brands.length > 6 && (
          <label>
            <span className="sr-only">Search brands</span>
            <input
              className={inputClass}
              type="search"
              value={brandQuery}
              onChange={(e) => setBrandQuery(e.target.value)}
              placeholder="Search brands"
            />
          </label>
        )}
        {draft.brands.length > 0 && (
          <p className="mt-2 text-sm">
            Selected: {draft.brands.map((brand) => brand.trim()).join(', ')}
          </p>
        )}
        <div className="mt-2 space-y-1">
          {visible.map((brand) => (
            <label key={brand} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={draft.brands.includes(brand)}
                onChange={() =>
                  onChange({
                    ...draft,
                    brands: draft.brands.includes(brand)
                      ? draft.brands.filter((b) => b !== brand)
                      : [...draft.brands, brand],
                  })
                }
              />
              {brand.trim()}
            </label>
          ))}
          {!visible.length && <p>No brands match this text.</p>}
        </div>
      </RefinementGroup>
      {(processors.length > 0 || !!draft.processor) && (
        <RefinementGroup
          group="processor"
          title="Processor"
          open={!focusGroup || expanded === 'processor'}
          onToggle={
            focusGroup
              ? () => setExpanded(expanded === 'processor' ? '' : 'processor')
              : undefined
          }
        >
          <label>
            <span className="sr-only">Processor</span>
            <select
              className={inputClass}
              value={draft.processor ?? ''}
              onChange={(e) =>
                onChange({ ...draft, processor: e.target.value || undefined })
              }
            >
              <option value="">Any processor</option>
              {[
                ...new Set([
                  ...processors,
                  ...(draft.processor ? [draft.processor] : []),
                ]),
              ].map((processor) => (
                <option key={processor} value={processor}>
                  {processor}
                </option>
              ))}
            </select>
          </label>
        </RefinementGroup>
      )}
      <RefinementGroup
        group="condition"
        title="Condition"
        open={!focusGroup || expanded === 'condition'}
        onToggle={
          focusGroup
            ? () => setExpanded(expanded === 'condition' ? '' : 'condition')
            : undefined
        }
      >
        <label>
          <span className="sr-only">Condition</span>
          <select
            className={inputClass}
            value={draft.condition ?? ''}
            onChange={(e) =>
              onChange({
                ...draft,
                condition: (e.target.value ||
                  undefined) as SearchRefinements['condition'],
              })
            }
          >
            <option value="">Any condition</option>
            {conditions.map((value) => (
              <option key={value} value={value}>
                {value === 'new'
                  ? 'New'
                  : value === 'used'
                    ? 'Used'
                    : 'Open Box'}
              </option>
            ))}
          </select>
        </label>
      </RefinementGroup>
      <RefinementGroup
        group="rating"
        title="Rating"
        open={!focusGroup || expanded === 'rating'}
        onToggle={
          focusGroup
            ? () => setExpanded(expanded === 'rating' ? '' : 'rating')
            : undefined
        }
      >
        <label>
          <span className="sr-only">Rating</span>
          <select
            className={inputClass}
            value={draft.minRating?.toString() ?? ''}
            onChange={(e) =>
              onChange({
                ...draft,
                minRating: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          >
            <option value="">Any rating</option>
            {[4, 3, 2, 1].map((rating) => (
              <option key={rating} value={rating}>
                {rating}+ stars
              </option>
            ))}
          </select>
        </label>
      </RefinementGroup>
    </div>
  );
}

function RefinementGroup({
  group,
  title,
  open,
  onToggle,
  children,
}: {
  group: string;
  title: string;
  open: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  return (
    <fieldset data-filter-group={group} className="min-w-0">
      <legend className="mb-2 w-full font-semibold">
        {onToggle ? (
          <button
            type="button"
            aria-expanded={open}
            className="flex min-h-12 w-full items-center justify-between rounded-lg bg-store-background-text/5 px-3 text-left"
            onClick={onToggle}
          >
            {title}
            <span aria-hidden="true">{open ? '−' : '+'}</span>
          </button>
        ) : (
          title
        )}
      </legend>
      {open && children}
    </fieldset>
  );
}
