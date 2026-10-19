// Required for server-backed search, filters, sorting, pagination, and toast interactions.
'use client';

import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiGet } from '@/lib/api-client';
import type { AdminMerchantsQuery } from '@/schemas/admin-merchants-query';
import type {
  AdminMerchantHealthRow,
  AdminMerchantsResponse,
} from '@/types/admin-merchants';
import { MerchantDirectoryCard } from './merchant-directory-card';
import type { HealthFilter } from './merchant-health-filter';

export type { HealthFilter } from './merchant-health-filter';

const MAX_MERCHANT_DIRECTORY_OFFSET = 10_000;
const SEARCH_DEBOUNCE_MS = 300;

function toRequestUrl(query: AdminMerchantsQuery): string {
  const params = new URLSearchParams({
    health: query.health,
    limit: String(query.limit),
    offset: String(query.offset),
    sortBy: query.sortBy,
  });
  if (query.search) params.set('search', query.search);
  return `/api/admin/merchants?${params.toString()}`;
}

export function MerchantsClient({
  initialError = null,
  initialHealthFilter,
  initialMerchants,
  initialQuery,
  initialTotal,
}: {
  initialError?: string | null;
  initialHealthFilter?: HealthFilter;
  initialMerchants: AdminMerchantHealthRow[];
  initialQuery?: AdminMerchantsQuery;
  initialTotal?: number;
}) {
  const [merchants, setMerchants] = useState(initialMerchants);
  const [query, setQuery] = useState<AdminMerchantsQuery>(
    initialQuery ?? {
      health: initialHealthFilter ?? 'all',
      limit: 50,
      offset: 0,
      search: undefined,
      sortBy: 'gmv',
    }
  );
  const [searchInput, setSearchInput] = useState(query.search ?? '');
  const [total, setTotal] = useState(initialTotal ?? initialMerchants.length);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  const { toast } = useToast();
  const hasMounted = useRef(false);
  const latestLoadId = useRef(0);

  const fetchMerchants = async (requestedQuery = query) => {
    const loadId = latestLoadId.current + 1;
    latestLoadId.current = loadId;
    try {
      setLoading(true);
      const response = await apiGet<AdminMerchantsResponse>(
        toRequestUrl(requestedQuery)
      );
      if (latestLoadId.current !== loadId) return;
      setMerchants(response.data);
      setTotal(response.pagination.total);
      setLoadError(null);
    } catch {
      if (latestLoadId.current !== loadId) return;
      console.error('Failed to fetch merchants');
      setLoadError('Failed to load merchant data.');
      toast({
        description: 'Failed to load merchant data.',
        title: 'Error',
        variant: 'destructive',
      });
    } finally {
      if (latestLoadId.current === loadId) setLoading(false);
    }
  };

  const reloadForQuery = useEffectEvent(
    (requestedQuery: AdminMerchantsQuery) => {
      void fetchMerchants(requestedQuery);
    }
  );

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    reloadForQuery(query);
  }, [query]);

  useEffect(() => {
    if (searchInput === (query.search ?? '')) return;

    const timeout = window.setTimeout(() => {
      setQuery((current) => ({
        ...current,
        offset: 0,
        search: searchInput || undefined,
      }));
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [query.search, searchInput]);

  const updateFilters = (next: Partial<AdminMerchantsQuery>) => {
    setQuery((current) => ({ ...current, ...next, offset: 0 }));
  };
  const shownStart = total === 0 ? 0 : query.offset + 1;
  const shownEnd = Math.min(query.offset + merchants.length, total);
  const reachedDirectoryBoundary =
    query.offset >= MAX_MERCHANT_DIRECTORY_OFFSET;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-page-title">Merchants</h1>
          <p className="text-muted-foreground">
            View paid-sales activity and operational status.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void fetchMerchants()}
          disabled={loading}
        >
          <RefreshCw
            className={`mr-2 size-4 ${loading ? 'motion-safe:animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </div>
      {loadError ? (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          <p className="font-medium">Merchant data could not load.</p>
          <p>{loadError} Use Refresh to try again.</p>
        </div>
      ) : null}
      <MerchantDirectoryCard
        filteredMerchants={merchants}
        healthFilter={query.health}
        loading={loading}
        onHealthFilterChange={(health) => updateFilters({ health })}
        onInvalidStorefrontUrl={() =>
          toast({
            description: 'Could not generate a valid storefront URL.',
            title: 'Error',
            variant: 'destructive',
          })
        }
        onSearchQueryChange={setSearchInput}
        onSortByChange={(sortBy) => {
          if (sortBy === 'gmv' || sortBy === 'orders' || sortBy === 'joined')
            updateFilters({ sortBy });
        }}
        searchQuery={searchInput}
        sortBy={query.sortBy}
      />
      {!loading ? (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>
            Showing {shownStart}–{shownEnd} of {total} merchants
          </p>
          {reachedDirectoryBoundary ? (
            <p className="text-amber-700 dark:text-amber-300">
              This view stops at the configured 10,000-row merchant directory
              boundary.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setQuery((current) => ({
                  ...current,
                  offset: Math.max(0, current.offset - current.limit),
                }))
              }
              disabled={query.offset === 0}
            >
              <ChevronLeft className="mr-1 size-4" aria-hidden="true" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setQuery((current) => ({
                  ...current,
                  offset: Math.min(
                    MAX_MERCHANT_DIRECTORY_OFFSET,
                    current.offset + current.limit
                  ),
                }))
              }
              disabled={shownEnd >= total || reachedDirectoryBoundary}
            >
              Next
              <ChevronRight className="ml-1 size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
