import { afterEach, describe, expect, it, vi } from 'vitest';
import { merchantSupabaseClientCache } from './merchant-supabase-client';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mocks.createClient,
}));

describe('merchant-supabase-client', () => {
  afterEach(() => {
    merchantSupabaseClientCache.reset();
    vi.clearAllMocks();
  });

  it('shares one client resolution across callers', async () => {
    const client = { from: vi.fn() };
    mocks.createClient.mockReturnValue(client);

    const [first, second] = await Promise.all([
      merchantSupabaseClientCache.get(),
      merchantSupabaseClientCache.get(),
    ]);

    expect(first).toBe(client);
    expect(second).toBe(client);
    expect(mocks.createClient).toHaveBeenCalledOnce();
  });

  it('drops a rejected import so the next call retries', async () => {
    mocks.createClient
      .mockImplementationOnce(() => {
        throw new Error('chunk failed');
      })
      .mockReturnValue({ from: vi.fn() });

    await expect(merchantSupabaseClientCache.get()).rejects.toThrow(
      'chunk failed'
    );
    await expect(merchantSupabaseClientCache.get()).resolves.toBeDefined();
    expect(mocks.createClient).toHaveBeenCalledTimes(2);
  });

  it('resets the cache on demand', async () => {
    mocks.createClient.mockReturnValue({ from: vi.fn() });

    await merchantSupabaseClientCache.get();
    merchantSupabaseClientCache.reset();
    await merchantSupabaseClientCache.get();

    expect(mocks.createClient).toHaveBeenCalledTimes(2);
  });
});
