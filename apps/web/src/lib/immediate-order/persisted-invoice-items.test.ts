import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPersistedInvoiceOrderItems } from './persisted-invoice-items';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

function stubSupabase(responses: Array<{ data: unknown; error: unknown }>) {
  const calls: unknown[][] = [];
  let index = 0;
  return {
    calls,
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => {
              const response = responses[Math.min(index, responses.length - 1)];
              index += 1;
              calls.push([response]);
              return Promise.resolve(response);
            },
          }),
        }),
      }),
    },
  };
}

const validRow = {
  id: 'item-1',
  product_id: 'p1',
  name: 'Phone',
  quantity: 2,
  price: 20000,
};

describe('loadPersistedInvoiceOrderItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes persisted rows on the first attempt', async () => {
    const stub = stubSupabase([{ data: [validRow], error: null }]);

    const items = await loadPersistedInvoiceOrderItems({
      orderId: 'order-1',
      supabase: stub.client as never,
    });

    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({
      product_id: 'p1',
      name: 'Phone',
      quantity: 2,
      price: 20000,
    });
    expect(stub.calls).toHaveLength(1);
  });

  it('drops unusable rows and returns null when nothing normalizes', async () => {
    const stub = stubSupabase([
      { data: [{ name: 'Ghost', quantity: 0, price: 100 }], error: null },
    ]);

    await expect(
      loadPersistedInvoiceOrderItems({
        orderId: 'order-1',
        supabase: stub.client as never,
      })
    ).resolves.toBeNull();
    expect(stub.calls).toHaveLength(3);
  });

  it('retries lookup errors and gives up after three attempts', async () => {
    const stub = stubSupabase([{ data: null, error: { message: 'down' } }]);

    await expect(
      loadPersistedInvoiceOrderItems({
        orderId: 'order-1',
        supabase: stub.client as never,
      })
    ).resolves.toBeNull();
    expect(stub.calls).toHaveLength(3);
  });
});
