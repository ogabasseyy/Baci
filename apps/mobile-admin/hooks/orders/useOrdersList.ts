import type {
  Order,
  OrderItem,
  PaymentStatus,
  ShippingStatus,
} from '@baci/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getBranchScopeKey } from '@/lib/branch-scope-query';
import { ORDER_COLUMNS } from '@/lib/orders';
import { sanitizeText } from '@/lib/sanitize';
import { supabase } from '@/lib/supabase';
import { ALL_BRANCH_SCOPE, type BranchScope } from '@/schemas/branch';
import {
  type OrderListRow,
  orderListRowSchema,
} from '@/schemas/order-list-row';
import { useBranchScope } from '../useBranchScope';
import { useMerchant } from '../useMerchant';
import { applyOrderListVisibilityFilter } from './order-list-visibility';
import { findCustomerIdsMatchingSearch } from './order-search-customers';
import type { OrdersPage, OrderWithCount } from './order-types';

const PAGE_SIZE = 20;
const ORDER_SEARCH_FIELDS = [
  'order_number',
  'customer_name',
  'customer_email',
  'customer_phone',
  'payment_method',
  'tracking_number',
  'tracking_token',
] as const;

function escapePostgrestIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function quotePostgrestFilterValue(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

function buildAdminOrderSearchFilter(
  searchTerm: string,
  matchedCustomerIds: string[] = []
): string {
  const escapedTerm = escapePostgrestIlikePattern(searchTerm);
  const quotedPattern = quotePostgrestFilterValue(`%${escapedTerm}%`);
  const filters = ORDER_SEARCH_FIELDS.map(
    (field) => `${field}.ilike.${quotedPattern}`
  );

  if (matchedCustomerIds.length > 0) {
    const ids = matchedCustomerIds.map(quotePostgrestFilterValue).join(',');
    filters.push(`customer_id.in.(${ids})`);
  }

  return filters.join(',');
}

function parseOrderListRows(rows: unknown[]) {
  const normalizedRows: OrderListRow[] = [];

  for (const row of rows) {
    const parsedRow = orderListRowSchema.safeParse(row);

    if (parsedRow.success) {
      normalizedRows.push(parsedRow.data);
      continue;
    }

    console.warn('Skipping invalid order row in orders list', {
      issues: parsedRow.error.issues.map((issue) => issue.path.join('.')),
    });
  }

  return normalizedRows;
}

export type { Order, OrderItem, OrdersPage, OrderWithCount, ShippingStatus };

export async function fetchOrders(
  merchantId: string,
  cursor: number = 0,
  filters?: {
    dateFilter?: string | { end: Date; start: Date } | null;
    paymentStatus?: PaymentStatus;
    search?: string;
    status?: ShippingStatus;
  },
  scope: BranchScope = ALL_BRANCH_SCOPE
): Promise<OrdersPage> {
  let query = supabase
    .from('orders')
    .select(`${ORDER_COLUMNS}, order_items(id)`, { count: 'exact' })
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })
    .range(cursor, cursor + PAGE_SIZE - 1);

  query = applyOrderListVisibilityFilter(query);

  if (scope.type === 'branch') {
    query = query.eq('branch_id', scope.branchId);
  }

  if (filters?.status) {
    query = query.eq('shipping_status', filters.status);
  }

  if (filters?.paymentStatus) {
    query = query.eq('payment_status', filters.paymentStatus);
  }

  if (filters?.search) {
    const term = sanitizeText(filters.search, 200);
    if (term) {
      const matchedCustomerIds = await findCustomerIdsMatchingSearch(
        merchantId,
        term
      );
      query = query.or(buildAdminOrderSearchFilter(term, matchedCustomerIds));
    }
  }

  if (filters?.dateFilter) {
    const dateFilter = filters.dateFilter;

    if (dateFilter === 'Today') {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      query = query.gte('created_at', date.toISOString());
    } else if (dateFilter === 'Last 7 Days') {
      const date = new Date();
      date.setDate(date.getDate() - 7);
      query = query.gte('created_at', date.toISOString());
    } else if (dateFilter === 'Last 30 Days') {
      const date = new Date();
      date.setDate(date.getDate() - 30);
      query = query.gte('created_at', date.toISOString());
    } else if (dateFilter === 'This Month') {
      const date = new Date();
      const start = new Date(
        date.getFullYear(),
        date.getMonth(),
        1
      ).toISOString();
      query = query.gte('created_at', start);
    } else if (
      typeof dateFilter === 'object' &&
      dateFilter.start &&
      dateFilter.end
    ) {
      const start = new Date(dateFilter.start);
      start.setHours(0, 0, 0, 0);

      const end = new Date(dateFilter.end);
      end.setHours(23, 59, 59, 999);

      query = query
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString());
    }
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const hasMore = (count ?? 0) > cursor + PAGE_SIZE;
  const normalizedRows = parseOrderListRows(data ?? []);
  const orders = normalizedRows.map((order) => {
    const { order_items, ...normalizedOrder } = order;

    return {
      ...normalizedOrder,
      item_count: order_items?.length ?? 0,
      order_items: undefined,
    } as unknown as OrderWithCount;
  });

  return {
    nextCursor: hasMore ? cursor + PAGE_SIZE : null,
    orders,
    totalCount: count ?? 0,
  };
}

export function useOrders(
  status: ShippingStatus | 'all' = 'all',
  searchQuery: string = '',
  dateFilter: string | { end: Date; start: Date } | null = null,
  paymentStatus: PaymentStatus | 'all' = 'all'
) {
  const { merchant } = useMerchant();
  const { scope } = useBranchScope();
  const merchantId = merchant?.id;
  const branchScopeKey = getBranchScopeKey(scope);

  const filters = {
    dateFilter: dateFilter === null ? undefined : dateFilter,
    paymentStatus: paymentStatus === 'all' ? undefined : paymentStatus,
    search: searchQuery === '' ? undefined : searchQuery,
    status: status === 'all' ? undefined : status,
  };

  return useInfiniteQuery<OrdersPage, Error>({
    enabled: !!merchantId,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) => {
      if (!merchantId) {
        throw new Error('Merchant ID is required');
      }

      return fetchOrders(merchantId, pageParam as number, filters, scope);
    },
    queryKey: ['orders', merchantId, filters, branchScopeKey],
    staleTime: 1000 * 60,
  });
}
