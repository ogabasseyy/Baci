// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createVerifierWorkerResolver } from './worker-resolver';

function fixture(stopDuring?: 'merchants' | 'experience_builds') {
  const controller = new AbortController();
  const bound = vi.fn((table: string, _signal: AbortSignal) => {
    if (table === stopDuring) controller.abort();
  });
  const canonicalBase = vi.fn(async () => {
    controller.abort();
    return 'https://merchant.example';
  });
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }),
    },
    rpc: () => ({ abortSignal: async () => ({ data: true, error: null }) }),
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        abortSignal: (signal: AbortSignal) => {
          bound(table, signal);
          return query;
        },
        maybeSingle: async () => ({
          data:
            table === 'merchants'
              ? { slug: 'synthetic' }
              : { host_origin: 'https://merchant.example' },
          error: null,
        }),
      };
      return query;
    }),
  };
  const resolver = createVerifierWorkerResolver({
    pool: {} as never,
    runner: {} as never,
    previewOrigin: 'https://builder.example',
    executionOrigin: 'https://output.example.net',
    canonicalBase,
  });
  return {
    request: () =>
      resolver.resolve(
        {
          merchantId: 'synthetic-merchant',
          supabase: supabase as never,
          signal: controller.signal,
        },
        'synthetic-build'
      ),
    supabase,
    signal: controller.signal,
    bound,
    canonicalBase,
  };
}

it.each([
  'merchants',
  'experience_builds',
] as const)('stops when the %s read is cancelled', async (table) => {
  const f = fixture(table);
  await expect(f.request()).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.bound).toHaveBeenCalledWith(table, f.signal);
  expect(f.canonicalBase).not.toHaveBeenCalled();
  if (table === 'merchants') expect(f.supabase.from).toHaveBeenCalledOnce();
});

it('passes the same caller signal through canonical-domain lookup', async () => {
  const f = fixture();
  await expect(f.request()).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.bound.mock.calls).toEqual([
    ['merchants', f.signal],
    ['experience_builds', f.signal],
  ]);
  expect(f.canonicalBase).toHaveBeenCalledExactlyOnceWith(
    'synthetic',
    f.supabase,
    f.signal
  );
});
