import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerError = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

import { resolveAuthoritativeMerchantSlug } from './resolve-authoritative-merchant-slug';

function makeSupabase(result: {
  data: { slug: string | null } | null;
  error: unknown;
}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(result),
        }),
      }),
    }),
  } as never;
}

describe('resolveAuthoritativeMerchantSlug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok with trimmed canonical slug when it matches case-insensitively', async () => {
    const result = await resolveAuthoritativeMerchantSlug(
      makeSupabase({ data: { slug: '  ogabassey ' }, error: null }),
      'merchant-1',
      'Ogabassey'
    );

    expect(result).toEqual({ status: 'ok', slug: 'ogabassey' });
    expect(mockLoggerError).not.toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('returns mismatch when resolved slug differs from caller slug', async () => {
    const result = await resolveAuthoritativeMerchantSlug(
      makeSupabase({ data: { slug: 'ogabassey' }, error: null }),
      'merchant-1',
      'other-store'
    );

    expect(result).toEqual({ status: 'mismatch' });
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
  });

  it('returns skipped when merchant lookup fails or slug is missing', async () => {
    const lookupFailed = await resolveAuthoritativeMerchantSlug(
      makeSupabase({ data: null, error: new Error('db error') }),
      'merchant-1',
      'ogabassey'
    );
    expect(lookupFailed).toEqual({ status: 'skipped' });

    const missingSlug = await resolveAuthoritativeMerchantSlug(
      makeSupabase({ data: { slug: '  ' }, error: null }),
      'merchant-1',
      'ogabassey'
    );
    expect(missingSlug).toEqual({ status: 'skipped' });
    expect(mockLoggerError).toHaveBeenCalledTimes(2);
  });
});
