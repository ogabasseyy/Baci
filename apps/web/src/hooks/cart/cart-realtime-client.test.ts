import { createClient } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  loadCartReceiveAccess,
  openCartReceiveConnection,
} from './cart-realtime-client';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'public-test-key',
}));
beforeEach(() => vi.clearAllMocks());
it('projects only short-lived receive fields from an uncached same-origin request', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        topic: 'cart:m:c',
        token: 'receive',
        expiresAt: '2099-01-01',
        privateMetadata: 'must-not-escape',
      })
    )
  );
  expect(await loadCartReceiveAccess('two shops')).toEqual({
    topic: 'cart:m:c',
    token: 'receive',
    expiresAt: '2099-01-01',
  });
  expect(fetcher).toHaveBeenCalledWith(
    '/api/storefront/cart/realtime?merchantSlug=two%20shops',
    { credentials: 'same-origin', cache: 'no-store' }
  );
  fetcher.mockRestore();
});
it('uses an isolated receive-only private channel and closes it', async () => {
  const channel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };
  const client = {
    realtime: {
      setAuth: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(createClient).mockReturnValue(
    client as unknown as ReturnType<typeof createClient>
  );
  const connection = await openCartReceiveConnection(
    { topic: 'cart:m:c', token: 'receive', expiresAt: '2099-01-01' },
    vi.fn(),
    vi.fn()
  );
  expect(createClient).toHaveBeenCalledWith(
    'https://test.supabase.co',
    'public-test-key',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
  expect(client.realtime.setAuth).toHaveBeenCalledWith('receive');
  expect(client.channel).toHaveBeenCalledWith('cart:m:c', {
    config: { private: true, broadcast: { self: false } },
  });
  expect(Object.keys(connection)).toEqual(['disconnect']);
  await connection.disconnect();
  expect(client.removeChannel).toHaveBeenCalledWith(channel);
  expect(client.realtime.disconnect).toHaveBeenCalled();
});

it('keeps temporary access outages retryable without treating them as revocation', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 503 }));
  await expect(loadCartReceiveAccess('shop')).rejects.toThrow(
    'temporarily unavailable'
  );
  fetcher.mockRestore();
});
