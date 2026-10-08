'use client';
import type { SearchRefinements } from '@baci/shared/lib';
import { deduplicateFacetChoices, isSameFacetChoice } from '@baci/shared/lib';
import { useState } from 'react';
import { getSearchCurrencyFormatter } from './search-currency';
import type { RefinementDraft } from './search-refinement-draft';
import { RefinementGroup } from './search-refinement-group';
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
  // Facet spellings first so draft values resolve to the returned
  // spelling; the SQL filter folds case, so the choices must too.
  const visible = deduplicateFacetChoices([...brands, ...draft.brands]).filter(
    (brand) => brand.toLowerCase().includes(brandQuery.toLowerCase())
  );
  const visibleProcessors = deduplicateFacetChoices([
    ...processors,
    ...(draft.processor ? [draft.processor] : []),
  ]);
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
            {[
              ...categories,
              // A deactivated category keeps constraining the search while
              // its id is in the draft, so surface it explicitly (its name
              // is unknowable once it leaves the facet response) instead of
              // falsely displaying "All categories".
              ...(!categories.some(
                (category) => category.id === draft.categoryId
              ) && draft.categoryId
                ? [{ id: draft.categoryId, name: 'Unavailable category' }]
                : []),
            ].map((category) => (
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
                checked={draft.brands.some((b) => isSameFacetChoice(b, brand))}
                onChange={() =>
                  onChange({
                    ...draft,
                    brands: draft.brands.some((b) =>
                      isSameFacetChoice(b, brand)
                    )
                      ? draft.brands.filter((b) => !isSameFacetChoice(b, brand))
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
              value={
                visibleProcessors.find(
                  (processor) =>
                    draft.processor !== undefined &&
                    isSameFacetChoice(processor, draft.processor)
                ) ?? ''
              }
              onChange={(e) =>
                onChange({ ...draft, processor: e.target.value || undefined })
              }
            >
              <option value="">Any processor</option>
              {visibleProcessors.map((processor) => (
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
            {[
              ...new Set([
                ...conditions,
                ...(draft.condition ? [draft.condition] : []),
              ]),
            ].map((value) => (
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
