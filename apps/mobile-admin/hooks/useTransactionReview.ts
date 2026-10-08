import { useQuery } from '@tanstack/react-query';
import { useMerchant } from '@/hooks/useMerchant';
import { fetchTransactionReviewWithFallbacks } from '@/lib/fetch-transaction-review-with-fallbacks';
import { filterExcludedTransactionReviewRows } from '@/lib/filter-excluded-transaction-review-rows';
import {
  searchTransactionReviewOrders,
  TRANSACTION_REVIEW_SEARCH_LIMIT,
} from '@/lib/search-transaction-review-orders';
import {
  buildTransactionReviewRangeFilters,
  filterTransactionOrders,
  mapTransactionOrderRows,
  type TransactionReviewItem,
  type TransactionReviewOrder,
  type TransactionReviewOrderRow,
} from '@/lib/transaction-review';
import { filterOrdersForTransactionTab } from '@/lib/transaction-review-inputs';
import { TRANSACTION_REVIEW_SELECTORS } from '@/lib/transaction-review-selectors';

interface TransactionReviewRange {
  endDate?: Date;
  startDate?: Date;
}

export type { TransactionReviewItem, TransactionReviewOrder };

export const TRANSACTION_REVIEW_LEGACY_SELECT =
  TRANSACTION_REVIEW_SELECTORS.legacy;

function mapTransactionReviewData(data: unknown) {
  return mapTransactionOrderRows(
    filterExcludedTransactionReviewRows(
      (data ?? []) as unknown as TransactionReviewOrderRow[]
    )
  );
}

export function useTransactionReview(
  range?: TransactionReviewRange,
  options: {
    enabled?: boolean;
    exactDates?: boolean;
    search?: string;
    tab?: 'missing-costs' | 'paid';
  } = {}
) {
  const { merchant } = useMerchant();
  const trimmedSearch = options.search?.trim() ?? '';
  const searching = trimmedSearch.length > 0;
  const startDateIso = options.exactDates
    ? range?.startDate?.toISOString()
    : range?.startDate
      ? new Date(
          Date.UTC(
            range.startDate.getUTCFullYear(),
            range.startDate.getUTCMonth(),
            range.startDate.getUTCDate(),
            0,
            0,
            0,
            0
          )
        ).toISOString()
      : undefined;
  const endDateIso = options.exactDates
    ? range?.endDate?.toISOString()
    : range?.endDate
      ? new Date(
          Date.UTC(
            range.endDate.getUTCFullYear(),
            range.endDate.getUTCMonth(),
            range.endDate.getUTCDate(),
            23,
            59,
            59,
            999
          )
        ).toISOString()
      : undefined;
  const { endDateFilter, startDateFilter } = buildTransactionReviewRangeFilters(
    startDateIso,
    endDateIso
  );

  const query = useQuery({
    queryKey: [
      'transaction-review',
      merchant?.id,
      startDateIso,
      endDateIso,
      searching ? trimmedSearch : null,
      Boolean(options.exactDates),
      // The tab only changes fetching while searching (the missing-costs
      // tab pages past the server cap); browsing filters client-side, so
      // the key stays stable on tab switches there.
      searching ? (options.tab ?? 'paid') : null,
    ],
    queryFn: async () => {
      if (!merchant?.id) {
        throw new Error('Merchant context is not ready');
      }

      if (searching) {
        return searchTransactionReview(
          merchant.id,
          trimmedSearch,
          options.tab ?? 'paid'
        );
      }

      const { data, error } = await fetchTransactionReviewWithFallbacks({
        endDateFilter,
        endDateIso,
        merchantId: merchant.id,
        startDateFilter,
        startDateIso,
      });

      if (error) {
        throw new Error(error.message);
      }

      return { orders: mapTransactionReviewData(data), searchTruncated: false };
    },
    enabled: Boolean(merchant?.id) && options.enabled !== false,
    staleTime: 1000 * 60,
  });

  return {
    ...query,
    data: query.data?.orders,
    searchTruncated: query.data?.searchTruncated ?? false,
  };
}

// Pages of ranked RPC candidates fetched while a post-server filter (the
// missing-costs tab) keeps the accumulated set short. Pages step by the
// display cap with a one-row peek overlap, so five pages cover 501 ranked
// candidates before stopping with a truncation notice.
const TRANSACTION_REVIEW_TAB_SEARCH_MAX_PAGES = 5;

async function hydrateSearchIds(merchantId: string, orderIds: string[]) {
  // Hydrate only the ranked top-100: hydration re-sorts by transaction date
  // with nulls last, so hydrating the peek row would let the display slice
  // drop a recent null-date match in favor of an older dated one. The peek
  // row exists only to detect truncation.
  const pageIds = orderIds.slice(0, TRANSACTION_REVIEW_SEARCH_LIMIT);
  const { data, error } = await fetchTransactionReviewWithFallbacks({
    merchantId,
    orderIds: pageIds,
  });

  if (error) {
    throw new Error(error.message);
  }

  // Restore RPC rank: hydration sorts null transaction dates last, which
  // would otherwise sink a recent null-date match below older dated rows
  // in search results. Refinement and tab filters preserve this order.
  const hydratedById = new Map(
    mapTransactionReviewData(data).map((order) => [order.id, order])
  );
  return pageIds.flatMap((orderId) => {
    const order = hydratedById.get(orderId);
    return order ? [order] : [];
  });
}

async function searchTransactionReview(
  merchantId: string,
  search: string,
  tab: 'missing-costs' | 'paid'
) {
  const firstPage = await searchTransactionReviewOrders({
    merchantId,
    search,
  });

  if (firstPage.error) {
    // Databases that predate the search RPC keep working through a capped
    // client-side scan until the migration lands. Histories under the scan
    // cap still match completely; larger ones surface a truncation notice
    // alongside any displayed results.
    if (firstPage.errorKind === 'missing-search-function') {
      const { data, error, truncated } =
        await fetchTransactionReviewWithFallbacks({
          fetchAll: true,
          merchantId,
        });

      if (error) {
        throw new Error(error.message);
      }

      const mapped = mapTransactionReviewData(data);
      // The capped scan is fully in memory, so the tab filter applies
      // before refinement and the display slice here (unlike the
      // single-page RPC path, where the server cap binds first and the tab
      // pages for the rest). Refinement judges visible items only, matching
      // the paged path.
      const orders = filterTransactionOrders(
        tab === 'missing-costs'
          ? filterOrdersForTransactionTab(mapped, 'missing-costs')
          : mapped,
        search
      );

      return {
        orders: orders.slice(0, TRANSACTION_REVIEW_SEARCH_LIMIT),
        searchTruncated:
          truncated || orders.length > TRANSACTION_REVIEW_SEARCH_LIMIT,
      };
    }

    throw new Error(firstPage.error.message);
  }

  if (tab !== 'missing-costs') {
    if (firstPage.orderIds.length === 0) {
      return { orders: [], searchTruncated: false };
    }

    // The truncation signal comes from the pre-refinement id count:
    // refinement can only shrink the set, so post-refinement length would
    // hide capped results.
    const orders = filterTransactionOrders(
      await hydrateSearchIds(merchantId, firstPage.orderIds),
      search
    );

    return {
      orders: orders.slice(0, TRANSACTION_REVIEW_SEARCH_LIMIT),
      searchTruncated:
        firstPage.orderIds.length > TRANSACTION_REVIEW_SEARCH_LIMIT,
    };
  }

  // The missing-costs tab filters after the server cap, so a page of newer
  // complete-cost matches would otherwise hide an older missing-cost match.
  // Page the ranked candidates until 100 post-tab orders accumulate or the
  // source runs dry. A mid-paging failure throws rather than presenting a
  // partial set as final.
  const accumulated: TransactionReviewOrder[] = [];
  let orderIds = firstPage.orderIds;
  for (
    let pageIndex = 0;
    pageIndex < TRANSACTION_REVIEW_TAB_SEARCH_MAX_PAGES;
    pageIndex += 1
  ) {
    if (orderIds.length === 0) {
      return { orders: accumulated, searchTruncated: false };
    }

    // Tab before refinement: refinement must judge the missing-cost items
    // the tab keeps, not items the tab is about to strip. Otherwise a mixed
    // order (matching complete-cost item, non-matching missing-cost item)
    // would consume cap space and then vanish in the screen's final search
    // filter, hiding older genuine matches.
    const pageOrders = filterTransactionOrders(
      filterOrdersForTransactionTab(
        await hydrateSearchIds(merchantId, orderIds),
        'missing-costs'
      ),
      search
    );
    // A full page carries the peek row, so more candidates may exist; a
    // short page means the source is exhausted. Either way, qualifying
    // orders dropped for cap space are truncation, not a complete set.
    const remaining = TRANSACTION_REVIEW_SEARCH_LIMIT - accumulated.length;
    accumulated.push(...pageOrders.slice(0, remaining));
    const pageFull = orderIds.length > TRANSACTION_REVIEW_SEARCH_LIMIT;
    const truncated = pageFull || pageOrders.length > remaining;
    if (!pageFull || accumulated.length >= TRANSACTION_REVIEW_SEARCH_LIMIT) {
      return { orders: accumulated, searchTruncated: truncated };
    }
    if (pageIndex + 1 >= TRANSACTION_REVIEW_TAB_SEARCH_MAX_PAGES) {
      // The page budget ran out with a full last page: more candidates
      // may exist beyond the accumulated set. Checked before fetching so
      // the final iteration never requests a page it would discard.
      return { orders: accumulated, searchTruncated: true };
    }

    const nextPage = await searchTransactionReviewOrders({
      merchantId,
      offset: (pageIndex + 1) * TRANSACTION_REVIEW_SEARCH_LIMIT,
      search,
    });
    if (nextPage.error) {
      throw new Error(nextPage.error.message);
    }
    orderIds = nextPage.orderIds;
  }

  // Unreachable: the budget check above returns on the final iteration.
  // Retained so every control-flow path returns a result.
  return { orders: accumulated, searchTruncated: true };
}
