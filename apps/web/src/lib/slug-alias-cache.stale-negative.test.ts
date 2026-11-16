import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAliasMaybeSingle = vi.fn();
const mockMerchantMaybeSingle = vi.fn();
const mockWaitUntil = vi.fn();

vi.mock('@vercel/functions', () => ({
  waitUntil: (pending: Promise<unknown>) => mockWaitUntil(pending),
}));

// Outside a Next.js request `after` refuses, as it does in this test run.
vi.mock('next/server', () => ({
  after: () => {
    throw new Error('after was called outside a request scope');
  },
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({
    from: (table: string) => {
      const resolver =
        table === 'merchant_slug_aliases'
          ? mockAliasMaybeSingle
          : mockMerchantMaybeSingle;
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        maybeSingle: (...args: unknown[]) => resolver(...args),
      };
      return builder;
    },
  }),
}));

const {
  getCurrentSlugForAlias,
  getCurrentSlugForAliasStrict,
  invalidateAliasCacheForSlug,
} = await import('./slug-alias-cache');

const notAnAlias = { data: null, error: null };
const renamedTo = (slug: string) => ({
  data: { merchants: { slug } },
  error: null,
});

/** A database answer the test releases by hand. */
function slowAnswer() {
  let release: (value: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  return { pending, release };
}

/** Lets the background refresh run to completion. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

describe('expired "not a retired slug" answers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockMerchantMaybeSingle.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers a live store at once and re-checks in the background', async () => {
    mockAliasMaybeSingle.mockResolvedValue(notAnAlias);
    expect(await getCurrentSlugForAlias('live-store')).toBeNull();

    vi.advanceTimersByTime(31_000);
    const slow = slowAnswer();
    mockAliasMaybeSingle.mockReturnValue(slow.pending);

    // The database has not answered, yet every waiting request gets its
    // answer: none of them pays for the re-check.
    expect(
      await Promise.all([
        getCurrentSlugForAlias('live-store'),
        getCurrentSlugForAlias('live-store'),
        getCurrentSlugForAlias('live-store'),
      ])
    ).toEqual([null, null, null]);
    await settle();

    // One re-check for the three requests, kept alive past the response.
    expect(mockAliasMaybeSingle).toHaveBeenCalledTimes(2);
    expect(mockWaitUntil).toHaveBeenCalled();

    slow.release(notAnAlias);
    await settle();
    expect(await getCurrentSlugForAlias('live-store')).toBeNull();
    expect(mockAliasMaybeSingle).toHaveBeenCalledTimes(2);
  });

  it('picks up a rename on the request after the background re-check', async () => {
    mockAliasMaybeSingle.mockResolvedValue(notAnAlias);
    expect(await getCurrentSlugForAlias('old-name')).toBeNull();

    vi.advanceTimersByTime(31_000);
    mockAliasMaybeSingle.mockResolvedValue(renamedTo('new-name'));
    expect(await getCurrentSlugForAlias('old-name')).toBeNull();
    await settle();

    expect(await getCurrentSlugForAlias('old-name')).toBe('new-name');
  });

  it('waits for the database once the old answer is over five minutes old', async () => {
    mockAliasMaybeSingle.mockResolvedValue(notAnAlias);
    expect(await getCurrentSlugForAlias('quiet-store')).toBeNull();

    vi.advanceTimersByTime(5 * 60_000 + 1);
    mockAliasMaybeSingle.mockResolvedValue(renamedTo('quiet-store-new'));
    expect(await getCurrentSlugForAlias('quiet-store')).toBe('quiet-store-new');
  });

  it('never serves an expired redirect target', async () => {
    mockAliasMaybeSingle.mockResolvedValue(renamedTo('second-name'));
    expect(await getCurrentSlugForAlias('first-name')).toBe('second-name');

    vi.advanceTimersByTime(121_000);
    mockAliasMaybeSingle.mockResolvedValue(renamedTo('third-name'));
    expect(await getCurrentSlugForAlias('first-name')).toBe('third-name');
    expect(mockWaitUntil).not.toHaveBeenCalled();
  });

  it('discards a background re-check that a rename overtook', async () => {
    mockAliasMaybeSingle.mockResolvedValue(notAnAlias);
    expect(await getCurrentSlugForAlias('racing')).toBeNull();

    vi.advanceTimersByTime(31_000);
    const slow = slowAnswer();
    mockAliasMaybeSingle.mockReturnValue(slow.pending);
    expect(await getCurrentSlugForAlias('racing')).toBeNull();
    await settle();

    // The rename flow clears this slug while the stale re-check is in flight.
    invalidateAliasCacheForSlug('racing');
    slow.release(notAnAlias);
    await settle();

    mockAliasMaybeSingle.mockResolvedValue(renamedTo('racing-new'));
    expect(await getCurrentSlugForAlias('racing')).toBe('racing-new');
  });

  it('discards a re-check when the rename lands before it starts', async () => {
    mockAliasMaybeSingle.mockResolvedValue(notAnAlias);
    expect(await getCurrentSlugForAlias('queued')).toBeNull();

    vi.advanceTimersByTime(31_000);
    // Scheduled, but its first step has not run when the rename clears it.
    const stale = getCurrentSlugForAlias('queued');
    invalidateAliasCacheForSlug('queued');
    expect(await stale).toBeNull();
    await settle();
    // The overtaken re-check did not even ask the database.
    expect(mockAliasMaybeSingle).toHaveBeenCalledTimes(1);

    // Nothing was written back, so the next request asks the database.
    mockAliasMaybeSingle.mockResolvedValue(renamedTo('queued-new'));
    expect(await getCurrentSlugForAlias('queued')).toBe('queued-new');
  });

  it('never serves a failed lookup past its thirty seconds', async () => {
    mockAliasMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'unavailable' },
    });
    expect(await getCurrentSlugForAlias('blip')).toBeNull();

    vi.advanceTimersByTime(31_000);
    mockAliasMaybeSingle.mockResolvedValue(renamedTo('blip-new'));
    expect(await getCurrentSlugForAlias('blip')).toBe('blip-new');
    expect(mockWaitUntil).not.toHaveBeenCalled();
  });

  it('always asks the database for strict callers', async () => {
    mockAliasMaybeSingle.mockResolvedValue(notAnAlias);
    expect(await getCurrentSlugForAlias('strict-store')).toBeNull();

    vi.advanceTimersByTime(31_000);
    mockAliasMaybeSingle.mockResolvedValue(renamedTo('strict-store-new'));
    expect(await getCurrentSlugForAliasStrict('strict-store')).toBe(
      'strict-store-new'
    );
    expect(mockWaitUntil).not.toHaveBeenCalled();
  });
});
