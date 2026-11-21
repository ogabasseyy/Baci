import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCrossRemCatalogVersion } from './catalog-version';

const { from, select, eq, maybeSingle, warn, config } = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  warn: vi.fn(),
  config: {
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    bindings: [{ listingId: 'fixture' }],
  },
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ from }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn } }));
vi.mock('./catalog-bindings', () => ({ crossRemCatalogConfig: config }));

describe('CrossRem catalog revision', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    config.bindings = [{ listingId: 'fixture' }];
    from.mockReturnValue({ select });
    select.mockReturnValue({ eq });
    eq.mockReturnValue({ maybeSingle });
  });

  it('reads only the configured merchant revision', async () => {
    maybeSingle.mockResolvedValue({
      data: { revision: 'fixture-revision' },
      error: null,
    });

    await expect(readCrossRemCatalogVersion()).resolves.toBe(
      'fixture-revision'
    );
    expect(from).toHaveBeenCalledExactlyOnceWith(
      'crossrem_catalog_generations'
    );
    expect(select).toHaveBeenCalledExactlyOnceWith('revision');
    expect(eq).toHaveBeenCalledExactlyOnceWith(
      'merchant_id',
      config.merchantId
    );
  });

  it('fails closed when the enrolled revision is not readable', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(readCrossRemCatalogVersion()).rejects.toThrow(
      'CrossRem catalog version unavailable'
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      message: 'CrossRem catalog enrollment or feed eligibility missing',
    });
  });

  it('fails closed on a database error or missing bindings', async () => {
    maybeSingle.mockResolvedValue({
      data: null,
      error: new Error('unavailable'),
    });
    await expect(readCrossRemCatalogVersion()).rejects.toThrow(
      'CrossRem catalog version unavailable'
    );
    from.mockClear();
    config.bindings = [];
    await expect(readCrossRemCatalogVersion()).rejects.toThrow(
      'CrossRem catalog is unconfigured'
    );
    expect(from).not.toHaveBeenCalled();
  });
});
