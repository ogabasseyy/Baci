import { DynamicServerError } from 'next/dist/client/components/hooks-server-context';
import { notFound, redirect } from 'next/navigation';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const order = vi.fn();
  const builder = { order, is: vi.fn(), eq: vi.fn() };
  builder.is.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return { order, builder };
});
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => mocks.builder }) }),
}));

import { getStorefrontNavigationCategories } from './cached-categories';

function thrown(callback: () => never): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }
}

describe('navigation framework control flow', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });
  it.each([
    ['redirect', () => thrown(() => redirect('/other'))],
    ['not-found', () => thrown(() => notFound())],
    ['dynamic rendering', () => new DynamicServerError('dynamic')],
  ])('rethrows the original %s error without logging', async (_label, makeError) => {
    const error = makeError();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.order.mockRejectedValueOnce(error);
    await expect(getStorefrontNavigationCategories('merchant-1')).rejects.toBe(
      error
    );
    expect(log).not.toHaveBeenCalled();
  });
  it('does not log a framework error returned in the query response', async () => {
    const error = thrown(() => notFound());
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.order.mockResolvedValueOnce({ data: null, error });
    await expect(getStorefrontNavigationCategories('merchant-1')).rejects.toBe(
      error
    );
    expect(log).not.toHaveBeenCalled();
  });
  it('rethrows a redirect from the direct retry after cache teardown', async () => {
    const error = thrown(() => redirect('/other'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.order.mockRejectedValueOnce(
      Object.assign(new Error('ended'), { digest: 'HANGING_PROMISE_REJECTION' })
    );
    mocks.order.mockRejectedValueOnce(error);
    await expect(getStorefrontNavigationCategories('merchant-1')).rejects.toBe(
      error
    );
    expect(log).not.toHaveBeenCalled();
  });
});
