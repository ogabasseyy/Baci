import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { GET } from './route';

const { notify, query } = vi.hoisted(() => ({
  notify: vi.fn(),
  query: vi.fn(),
}));
vi.mock('@/env', () => ({ getCronSecret: () => 'synthetic-cron' }));
vi.mock('@/lib/expo-push', () => ({ notifyLowStock: notify }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ order: () => ({ limit: query }) }) }),
      }),
    }),
  }),
}));
afterEach(() => vi.restoreAllMocks());
it.each([
  '%s',
  '%o',
  '%c',
])('keeps alert identifier %s out of the log format and continues the batch', async (id) => {
  query.mockResolvedValue({
    data: [
      {
        id,
        merchant_id: 'merchant',
        current_stock: 1,
        threshold: 5,
        products: { id: 'product', name: 'Phone' },
      },
    ],
    error: null,
  });
  const failure = new Error('synthetic push failed');
  notify.mockRejectedValue(failure);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const response = await GET(
    new NextRequest('https://usebaci.com/api/inventory/push-alerts', {
      headers: { authorization: 'Bearer synthetic-cron' },
    })
  );
  expect(await response.json()).toMatchObject({ sent: 0, failed: 1, total: 1 });
  expect(logged).toHaveBeenCalledWith(
    '[Inventory Alerts] Failed to notify for alert:',
    { alertId: id, error: failure }
  );
});
