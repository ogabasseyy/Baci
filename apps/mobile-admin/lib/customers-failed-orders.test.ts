import { describe, expect, it } from 'vitest';
import type { FailedOrder } from '@/hooks/useFailedOrders';
import {
  type GroupedFailedOrderListItem,
  getLocalDateKey,
  groupFailedOrdersByDate,
} from './customers-failed-orders';

const mockOrders: FailedOrder[] = [
  {
    attempt_count: 1,
    created_at: '2026-06-28T12:00:00.000Z',
    customer_email: 'john@example.com',
    customer_id: 'cust-1',
    customer_name: 'John Doe',
    customer_phone: '1234567890',
    id: '1',
    order_number: 'ORD-001',
    payment_method: 'card',
    payment_status: 'failed',
    total: 50_000,
  },
  {
    attempt_count: 2,
    created_at: '2026-06-27T15:30:00.000Z',
    customer_email: 'jane@example.com',
    customer_id: null,
    customer_name: 'Jane Smith',
    customer_phone: '0987654321',
    id: '2',
    order_number: 'ORD-002',
    payment_method: 'bnpl',
    payment_status: 'bnpl_pending',
    total: 120_000,
  },
  {
    attempt_count: 1,
    created_at: '2026-06-25T09:15:00.000Z',
    customer_email: 'alice@example.com',
    customer_id: 'cust-3',
    customer_name: 'Alice Johnson',
    customer_phone: '5555555555',
    id: '3',
    order_number: 'ORD-003',
    payment_method: 'transfer',
    payment_status: 'expired',
    total: 75_000,
  },
];

function getHeaders(data: GroupedFailedOrderListItem[]) {
  return data.filter((item) => item.type === 'header') as Extract<
    GroupedFailedOrderListItem,
    { type: 'header' }
  >[];
}

function getItems(data: GroupedFailedOrderListItem[]) {
  return data.filter((item) => item.type === 'item') as Extract<
    GroupedFailedOrderListItem,
    { type: 'item' }
  >[];
}

describe('groupFailedOrdersByDate', () => {
  it('shows older Oxygen reviews before newer ordinary follow-ups', () => {
    const review = {
      ...mockOrders[2],
      id: 'oxygen-review',
      oxygen_follow_up_status: 'needs_review' as const,
    };
    const { data, stickyHeaderIndices } = groupFailedOrdersByDate(
      [mockOrders[0], review],
      new Date('2026-06-28T20:00:00.000Z')
    );
    expect(getHeaders(data).map((header) => header.title)).toEqual([
      'Oxygen · Needs review',
      'Today',
    ]);
    expect(getItems(data).map((item) => item.data.id)).toEqual([
      'oxygen-review',
      '1',
    ]);
    expect(stickyHeaderIndices).toEqual([0, 2]);
  });
  it('groups a resumed Oxygen application by its latest workflow activity', () => {
    const oxygen = {
      ...mockOrders[2],
      id: 'oxygen',
      follow_up_at: '2026-06-28T18:00:00.000Z',
      oxygen_follow_up_status: 'oxygen_processing' as const,
    };
    const { data } = groupFailedOrdersByDate(
      [mockOrders[0], oxygen],
      new Date('2026-06-28T20:00:00.000Z')
    );
    expect(getHeaders(data).map((item) => item.title)).toEqual(['Today']);
    expect(getItems(data).map((item) => item.data.id)).toEqual(['oxygen', '1']);
  });

  it('groups failed orders by local date with sticky headers', () => {
    const now = new Date('2026-06-28T20:00:00.000Z');
    const { data, stickyHeaderIndices } = groupFailedOrdersByDate(
      mockOrders,
      now
    );

    expect(data).toHaveLength(6);
    expect(stickyHeaderIndices).toEqual([0, 2, 4]);
    expect(data[0]).toEqual({
      dateKey: '2026-06-28',
      key: 'failed-orders-header-2026-06-28',
      title: 'Today',
      type: 'header',
    });
    expect(data[1]).toEqual({
      data: mockOrders[0],
      key: 'failed-order-1',
      type: 'item',
    });
  });

  it('sorts date groups and their orders newest first', () => {
    const now = new Date('2026-06-28T20:00:00.000Z');
    const { data } = groupFailedOrdersByDate(
      [
        {
          ...mockOrders[0],
          created_at: '2026-06-28T09:00:00.000Z',
          id: 'old',
        },
        {
          ...mockOrders[0],
          created_at: '2026-06-28T18:00:00.000Z',
          id: 'new',
        },
        mockOrders[1],
      ],
      now
    );

    expect(getHeaders(data).map((item) => item.dateKey)).toEqual([
      '2026-06-28',
      '2026-06-27',
    ]);
    expect(getItems(data).map((item) => item.data.id)).toEqual([
      'new',
      'old',
      '2',
    ]);
  });

  it('labels today, yesterday, and older dates', () => {
    const now = new Date('2026-06-28T20:00:00.000Z');
    const { data } = groupFailedOrdersByDate(mockOrders, now);

    expect(getHeaders(data).map((item) => item.title)).toEqual([
      'Today',
      'Yesterday',
      'Thursday, June 25, 2026',
    ]);
  });

  it('keeps invalid created_at values visible under Date unavailable', () => {
    const invalidOrders: FailedOrder[] = [
      {
        ...mockOrders[0],
        created_at: 'invalid-date-string',
      },
    ];

    expect(
      groupFailedOrdersByDate(invalidOrders, new Date('2026-06-28')).data
    ).toEqual([
      expect.objectContaining({ type: 'header', title: 'Date unavailable' }),
      expect.objectContaining({ type: 'item', data: invalidOrders[0] }),
    ]);
  });

  it('uses non-colliding keys and local date keys', () => {
    const { data } = groupFailedOrdersByDate(
      mockOrders,
      new Date('2026-06-28T20:00:00.000Z')
    );

    expect(new Set(data.map((item) => item.key)).size).toBe(data.length);
    expect(getLocalDateKey('2026-06-28T12:00:00.000Z')).toBe('2026-06-28');
    expect(getLocalDateKey(new Date('2026-06-27T15:30:00.000Z'))).toBe(
      '2026-06-27'
    );
    expect(getLocalDateKey('invalid-date')).toBeNull();
  });
});
