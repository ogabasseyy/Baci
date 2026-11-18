import { beforeEach, expect, it, vi } from 'vitest';

const mockMerchantMaybeSingle = vi.fn();

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        maybeSingle: (...args: unknown[]) => mockMerchantMaybeSingle(...args),
      };
      return builder;
    },
  }),
}));

const { invalidateSlugLiveness, isSlugLive } = await import(
  './slug-liveness-cache'
);

beforeEach(() => {
  vi.clearAllMocks();
});

it('does not let a read that a rename overtook write its answer back', async () => {
  let release: (value: unknown) => void = () => undefined;
  mockMerchantMaybeSingle.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const inFlight = isSlugLive('reclaimed');

  // The rename flow clears the slug while the old read is still out.
  invalidateSlugLiveness('reclaimed');
  release({ data: null, error: null });
  expect(await inFlight).toBe(false);

  // The stale "not live" answer was not cached: this asks again.
  mockMerchantMaybeSingle.mockResolvedValue({
    data: { id: 'merchant-1' },
    error: null,
  });
  expect(await isSlugLive('reclaimed')).toBe(true);
  expect(mockMerchantMaybeSingle).toHaveBeenCalledTimes(2);
});
