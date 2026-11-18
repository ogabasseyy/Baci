import type { FailedOrder } from '@/hooks/useFailedOrders';

export type GroupedFailedOrderListItem =
  | {
      dateKey: string;
      key: string;
      title: string;
      type: 'header';
    }
  | {
      data: FailedOrder;
      key: string;
      type: 'item';
    };

export function getFollowUpActivityAt(order: FailedOrder): string {
  return order.follow_up_at ?? order.created_at;
}

export function getLocalDateKey(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDateGroupTitle(
  dateKey: string,
  todayKey: string | null,
  yesterdayKey: string | null
): string {
  if (dateKey === todayKey) {
    return 'Today';
  }
  if (dateKey === yesterdayKey) {
    return 'Yesterday';
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    year: 'numeric',
  });
}

export function groupFailedOrdersByDate(
  orders: FailedOrder[],
  now = new Date()
): {
  data: GroupedFailedOrderListItem[];
  stickyHeaderIndices: number[];
} {
  const groups = new Map<string, FailedOrder[]>();
  const oxygenReviews: FailedOrder[] = [];

  for (const order of orders) {
    const dateKey = getLocalDateKey(getFollowUpActivityAt(order)) ?? 'undated';

    if (order.oxygen_follow_up_status === 'needs_review') {
      oxygenReviews.push(order);
      continue;
    }

    const existing = groups.get(dateKey);
    if (existing) {
      existing.push(order);
    } else {
      groups.set(dateKey, [order]);
    }
  }

  const todayKey = getLocalDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = getLocalDateKey(yesterday);

  const data: GroupedFailedOrderListItem[] = [];
  const stickyHeaderIndices: number[] = [];

  if (oxygenReviews.length) {
    stickyHeaderIndices.push(data.length);
    data.push({
      dateKey: 'oxygen-review',
      key: 'failed-orders-header-oxygen-review',
      title: 'Oxygen · Needs review',
      type: 'header',
    });
    oxygenReviews.sort(
      (a, b) =>
        Date.parse(getFollowUpActivityAt(b)) -
        Date.parse(getFollowUpActivityAt(a))
    );
    for (const order of oxygenReviews) {
      data.push({ data: order, key: `failed-order-${order.id}`, type: 'item' });
    }
  }

  const sortedDateKeys = [...groups.keys()].sort((a, b) =>
    a === 'undated' ? 1 : b === 'undated' ? -1 : b.localeCompare(a)
  );

  for (const dateKey of sortedDateKeys) {
    stickyHeaderIndices.push(data.length);

    data.push({
      dateKey,
      key: `failed-orders-header-${dateKey}`,
      title:
        dateKey === 'undated'
          ? 'Date unavailable'
          : getDateGroupTitle(dateKey, todayKey, yesterdayKey),
      type: 'header',
    });

    const groupOrders = [...(groups.get(dateKey) ?? [])].sort(
      (a, b) =>
        new Date(getFollowUpActivityAt(b)).getTime() -
        new Date(getFollowUpActivityAt(a)).getTime()
    );

    for (const order of groupOrders) {
      data.push({
        data: order,
        key: `failed-order-${order.id}`,
        type: 'item',
      });
    }
  }

  return { data, stickyHeaderIndices };
}
