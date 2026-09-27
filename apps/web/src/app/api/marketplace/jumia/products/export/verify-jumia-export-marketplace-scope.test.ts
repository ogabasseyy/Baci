import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyJumiaSingleMarketplaceScope } from '@/lib/jumia/verify-jumia-single-marketplace-scope';
import { verifyJumiaExportMarketplaceScope } from './verify-jumia-export-marketplace-scope';

vi.mock('./export-product-reservation', () => ({
  releaseJumiaExportReservation: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));
vi.mock('@/lib/jumia/verify-jumia-single-marketplace-scope', () => ({
  verifyJumiaSingleMarketplaceScope: vi.fn(),
}));

describe('verifyJumiaExportMarketplaceScope', () => {
  function createScopeSupabase(
    count: number,
    error: { message: string } | null = null
  ) {
    const result = {
      data: Array.from({ length: count }, (_, i) => ({ id: `i-${i}` })),
      error,
    };
    const chain = {
      eq: vi.fn(),
    };
    chain.eq.mockReturnValue(chain);
    Object.defineProperty(chain, 'then', {
      value: (resolve: (value: unknown) => unknown) => resolve(result),
    });
    return {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(chain),
      }),
    };
  }

  function baseArgs(overrides: Record<string, unknown> = {}) {
    return {
      jumia: { shopId: 'shop-1' },
      supabase: createScopeSupabase(1),
      merchantId: 'merchant-1',
      productId: 'product-1',
      shopId: 'shop-1',
      marketplaceKey: 'NG-RETAIL',
      exportVariations: [{ sellerSku: 'SKU-1', price: 100, currency: 'NGN' }],
      ...overrides,
    } as never;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyJumiaSingleMarketplaceScope).mockResolvedValue({
      ok: true,
    });
  });

  it('passes legacy keys without verification', async () => {
    const { releaseJumiaExportReservation } = await import(
      './export-product-reservation'
    );

    for (const marketplaceKey of ['', 'default']) {
      const result = await verifyJumiaExportMarketplaceScope(
        baseArgs({ marketplaceKey })
      );

      expect(result).toEqual({ ok: true });
    }
    expect(verifyJumiaSingleMarketplaceScope).not.toHaveBeenCalled();
    expect(releaseJumiaExportReservation).not.toHaveBeenCalled();
  });

  it('rejects selected marketplace exports when the shop is shared', async () => {
    const { releaseJumiaExportReservation } = await import(
      './export-product-reservation'
    );
    vi.mocked(releaseJumiaExportReservation).mockResolvedValue(true);

    const result = await verifyJumiaExportMarketplaceScope(
      baseArgs({ supabase: createScopeSupabase(2) })
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      body: {
        error:
          'Jumia product creation cannot target a selected marketplace because the provider create-feed contract has no business-client selector. Use a single-marketplace integration or wait for provider support.',
      },
    });
    expect(releaseJumiaExportReservation).toHaveBeenCalled();
  });

  it('allows a self-authorized export when the shop has one active marketplace', async () => {
    const result = await verifyJumiaExportMarketplaceScope(baseArgs());

    expect(result).toEqual({ ok: true });
    expect(verifyJumiaSingleMarketplaceScope).toHaveBeenCalledWith(
      { shopId: 'shop-1' },
      undefined
    );
  });

  it('rejects a single local integration when the provider marketplace does not match', async () => {
    const { releaseJumiaExportReservation } = await import(
      './export-product-reservation'
    );
    vi.mocked(verifyJumiaSingleMarketplaceScope).mockResolvedValue({
      ok: false,
      reason: 'marketplace_mismatch',
    });
    vi.mocked(releaseJumiaExportReservation).mockResolvedValue(true);

    const result = await verifyJumiaExportMarketplaceScope(baseArgs());

    expect(result).toEqual({
      ok: false,
      status: 400,
      body: {
        error:
          'Jumia product creation cannot target a selected marketplace because the provider create-feed contract has no business-client selector. Use a single-marketplace integration or wait for provider support.',
      },
    });
    expect(releaseJumiaExportReservation).toHaveBeenCalled();
  });

  it('releases the reservation when marketplace scope cannot be verified', async () => {
    const { releaseJumiaExportReservation } = await import(
      './export-product-reservation'
    );
    vi.mocked(releaseJumiaExportReservation).mockResolvedValue(true);

    const result = await verifyJumiaExportMarketplaceScope(
      baseArgs({
        supabase: createScopeSupabase(0, { message: 'DB down' }),
      })
    );

    expect(result).toEqual({
      ok: false,
      status: 500,
      body: {
        error: 'Unable to verify the selected Jumia marketplace. Try again.',
      },
    });
    expect(releaseJumiaExportReservation).toHaveBeenCalled();
  });

  it('rejects an OAuth export when the shop exposes multiple marketplaces', async () => {
    const { releaseJumiaExportReservation } = await import(
      './export-product-reservation'
    );
    vi.mocked(verifyJumiaSingleMarketplaceScope).mockResolvedValue({
      ok: false,
      reason: 'multiple_active_marketplaces',
    });
    vi.mocked(releaseJumiaExportReservation).mockResolvedValue(true);

    const result = await verifyJumiaExportMarketplaceScope(
      baseArgs({ marketplaceKey: 'oauth' })
    );

    expect(result.ok).toBe(false);
    expect(verifyJumiaSingleMarketplaceScope).toHaveBeenCalledWith(
      { shopId: 'shop-1' },
      { strictOAuth: true }
    );
    expect(releaseJumiaExportReservation).toHaveBeenCalled();
  });

  it('allows an OAuth export when the shop has a single active marketplace', async () => {
    const result = await verifyJumiaExportMarketplaceScope(
      baseArgs({ marketplaceKey: 'oauth' })
    );

    expect(result).toEqual({ ok: true });
    expect(verifyJumiaSingleMarketplaceScope).toHaveBeenCalledWith(
      { shopId: 'shop-1' },
      { strictOAuth: true }
    );
  });
});
