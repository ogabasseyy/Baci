'use client';

import { Loader2, Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import {
  type QuizPrizeProduct,
  quizPrizeProductsResponseSchema,
} from '@/schemas/quiz-prize-product';
import { QuizPrizeProductResult } from './quiz-prize-product-result';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_PAGE_SIZE = 12;

interface QuizPrizeProductPickerProps {
  disabled?: boolean;
  initialError?: string | null;
  initialNextCursor?: string | null;
  initialProducts: QuizPrizeProduct[];
  onSelect: (product: QuizPrizeProduct) => void;
  selectedProduct: QuizPrizeProduct | null;
}

function getSearchErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Failed to search active inventory';
}

export function QuizPrizeProductPicker({
  disabled = false,
  initialError = null,
  initialNextCursor = null,
  initialProducts,
  onSelect,
  selectedProduct,
}: QuizPrizeProductPickerProps) {
  const listboxId = useId();
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState(initialProducts);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [searchError, setSearchError] = useState<string | null>(initialError);

  useEffect(() => {
    const normalizedSearch = search.trim();
    if (!normalizedSearch) {
      setProducts(initialProducts);
      setNextCursor(initialNextCursor);
      setIsSearching(false);
      setSearchError(initialError);
      setHighlightedIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setIsSearching(true);
      setSearchError(null);
      const query = new URLSearchParams({
        limit: String(SEARCH_PAGE_SIZE),
        search: normalizedSearch,
      });
      apiGet<unknown>(`/api/merchant/quiz/prize-products?${query.toString()}`, {
        signal: controller.signal,
      })
        .then((payload) => {
          const parsed = quizPrizeProductsResponseSchema.safeParse(payload);
          if (!parsed.success) {
            throw new Error('Invalid prize product search response');
          }
          setProducts(parsed.data.products);
          setNextCursor(parsed.data.nextCursor);
          setHighlightedIndex(parsed.data.products.length > 0 ? 0 : -1);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setProducts([]);
          setNextCursor(null);
          setSearchError(getSearchErrorMessage(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [initialError, initialNextCursor, initialProducts, search]);

  const selectProduct = (product: QuizPrizeProduct) => {
    onSelect(product);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const loadMore = () => {
    if (!nextCursor || isLoadingMore) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      cursor: nextCursor,
      limit: String(SEARCH_PAGE_SIZE),
    });
    if (search.trim()) query.set('search', search.trim());
    setIsLoadingMore(true);
    setSearchError(null);
    apiGet<unknown>(`/api/merchant/quiz/prize-products?${query.toString()}`, {
      signal: controller.signal,
    })
      .then((payload) => {
        const parsed = quizPrizeProductsResponseSchema.safeParse(payload);
        if (!parsed.success)
          throw new Error('Invalid prize product search response');
        setProducts((current) => [...current, ...parsed.data.products]);
        setNextCursor(parsed.data.nextCursor);
      })
      .catch((error: unknown) => setSearchError(getSearchErrorMessage(error)))
      .finally(() => setIsLoadingMore(false));
  };

  const normalizedSearch = search.trim();
  const activeId =
    highlightedIndex >= 0
      ? `${listboxId}-option-${highlightedIndex}`
      : undefined;

  return (
    <div className="grid gap-2 text-sm font-medium">
      <label htmlFor={`${listboxId}-input`}>Prize product</label>
      <div className="relative">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={isOpen}
            aria-label="Search prize product inventory"
            autoComplete="off"
            className="h-11 w-full rounded-md border bg-background pl-9 pr-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={disabled}
            id={`${listboxId}-input`}
            onChange={(event) => {
              setSearch(event.target.value);
              setIsOpen(true);
            }}
            onBlur={() => setIsOpen(false)}
            onFocus={() => setIsOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIsOpen(true);
                setHighlightedIndex((current) =>
                  Math.min(current + 1, products.length - 1)
                );
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlightedIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === 'Enter' && highlightedIndex >= 0) {
                event.preventDefault();
                const product = products[highlightedIndex];
                if (product?.available && !product.requiresVariantSelection) {
                  selectProduct(product);
                }
              } else if (event.key === 'Escape') {
                setIsOpen(false);
                setHighlightedIndex(-1);
              }
            }}
            placeholder="Search products, models, or SKU"
            role="combobox"
            type="search"
            value={search}
          />
          {isSearching ? (
            <Loader2
              aria-hidden="true"
              className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          ) : null}
        </div>

        {isOpen ? (
          <div
            aria-busy={isSearching || isLoadingMore}
            aria-label="Prize product results"
            className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1.5 shadow-lg"
            id={listboxId}
            onMouseDown={(event) => event.preventDefault()}
            role="listbox"
          >
            {isSearching ? (
              <p
                aria-live="polite"
                className="px-3 py-4 text-xs text-muted-foreground"
              >
                Searching inventory…
              </p>
            ) : null}
            {!isSearching && searchError ? (
              <p className="px-3 py-4 text-xs text-destructive" role="alert">
                {searchError}
              </p>
            ) : null}
            {!isSearching && !searchError && products.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">
                {normalizedSearch
                  ? 'No matching active products.'
                  : 'No active products found.'}
              </p>
            ) : null}
            {!isSearching && !searchError
              ? products.map((product, index) => (
                  <QuizPrizeProductResult
                    highlighted={highlightedIndex === index}
                    id={`${listboxId}-option-${index}`}
                    key={product.selectionId}
                    onSelect={selectProduct}
                    product={product}
                    selected={
                      selectedProduct?.selectionId === product.selectionId
                    }
                  />
                ))
              : null}
            {!isSearching && !searchError && nextCursor ? (
              <button
                className="mt-1 w-full rounded-md px-3 py-2 text-xs font-semibold text-primary hover:bg-accent disabled:opacity-60"
                disabled={isLoadingMore}
                onClick={loadMore}
                type="button"
              >
                {isLoadingMore ? 'Loading more…' : 'Load more inventory'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {selectedProduct ? (
        <p className="text-xs text-muted-foreground">
          Selected:{' '}
          <span className="font-medium text-foreground">
            {selectedProduct.name}
            {selectedProduct.variantLabel
              ? ` — ${selectedProduct.variantLabel}`
              : ''}
          </span>
        </p>
      ) : null}
    </div>
  );
}
