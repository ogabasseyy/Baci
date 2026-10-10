import { describe, expect, it, vi } from 'vitest';
import { fetchAllOrderRefundRows } from './fetch-all-order-refund-rows';

function pageQuery(pages: Array<{ data: unknown; error: unknown }>) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  const limit = vi.fn();
  for (const result of pages) {
    limit.mockResolvedValueOnce(result);
  }
  for (const method of ['select', 'eq', 'gt', 'order']) {
    query[method] = vi.fn(() => query);
  }
  query.limit = limit;
  return query;
}

describe('fetchAllOrderRefundRows', () => {
  const args = {
    columns: 'id, amount',
    completedOnly: false,
    merchantId: 'merchant-1',
    orderId: 'order-1',
  };

  it('returns every row across keyset pages', async () => {
    const first = Array.from({ length: 50 }, (_, index) => ({
      id: `refund-${index}`,
    }));
    const query = pageQuery([
      { data: first, error: null },
      { data: [{ id: 'refund-50' }], error: null },
    ]);
    const from = vi.fn(() => query);

    const rows = await fetchAllOrderRefundRows({ from } as never, args);

    expect(rows).toHaveLength(51);
    expect(query.gt).toHaveBeenCalledWith('id', 'refund-49');
    expect(query.limit).toHaveBeenCalledWith(50);
  });

  it('filters to completed rows when requested', async () => {
    const query = pageQuery([{ data: [], error: null }]);
    const from = vi.fn(() => query);

    await fetchAllOrderRefundRows({ from } as never, {
      ...args,
      completedOnly: true,
    });

    expect(query.eq).toHaveBeenCalledWith('status', 'completed');
  });

  it('throws for redelivery when the lookup fails', async () => {
    const query = pageQuery([{ data: null, error: { message: 'db down' } }]);
    const from = vi.fn(() => query);

    await expect(
      fetchAllOrderRefundRows({ from } as never, args)
    ).rejects.toThrow('refund_notification_replacement_lookup_failed');
  });

  it('throws when a full page cannot anchor the next cursor', async () => {
    const first = Array.from({ length: 50 }, (_, index) => ({
      id: index === 49 ? null : `refund-${index}`,
    }));
    const query = pageQuery([{ data: first, error: null }]);
    const from = vi.fn(() => query);

    await expect(
      fetchAllOrderRefundRows({ from } as never, args)
    ).rejects.toThrow('refund_notification_replacement_lookup_failed');
  });
});
