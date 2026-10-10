import { vi } from 'vitest';

export const row = {
  created_at: '2026-09-27T12:00:00Z',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
};

export const order = {
  currency: 'NGN',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_number: 'ORD-1',
};

export function chain(
  result: { data: unknown; error: unknown },
  terminal: 'in' | 'limit'
) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'eq', 'gt', 'in', 'order', 'limit']) {
    query[method] =
      method === terminal ? vi.fn(async () => result) : vi.fn(() => query);
  }
  return query;
}
