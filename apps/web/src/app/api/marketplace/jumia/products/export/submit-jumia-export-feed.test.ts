import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { verifyJumiaSingleMarketplaceScope } from '@/lib/jumia/verify-jumia-single-marketplace-scope';
import { submitJumiaExportFeed } from './submit-jumia-export-feed';

vi.mock('@/lib/jumia/feeds', () => ({
  createProduct: vi.fn(),
}));
vi.mock('./export-product-reservation', () => ({
  finalizeJumiaExportReservation: vi.fn(),
  markJumiaExportReservationForReconciliation: vi.fn(),
  releaseJumiaExportReservation: vi.fn(),
}));
vi.mock('./mark-ambiguous-jumia-export', () => ({
  markAmbiguousJumiaExport: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));
vi.mock('@/lib/jumia/verify-jumia-single-marketplace-scope', () => ({
  verifyJumiaSingleMarketplaceScope: vi.fn(),
}));

describe('submitJumiaExportFeed', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyJumiaSingleMarketplaceScope).mockResolvedValue({
      ok: true,
    });
  });

  it('releases the reservation after a definitive Jumia rejection', async () => {
    const { createProduct } = await import('@/lib/jumia/feeds');
    const { releaseJumiaExportReservation, finalizeJumiaExportReservation } =
      await import('./export-product-reservation');
    vi.mocked(createProduct).mockRejectedValue(
      new JumiaApiError(
        400,
        '{"listing":"private","message":"invalid product"}'
      )
    );
    vi.mocked(releaseJumiaExportReservation).mockResolvedValue(true);

    const result = await submitJumiaExportFeed({
      jumia: {} as never,
      supabase: {} as never,
      merchantId: 'merchant-1',
      productId: 'product-1',
      shopId: 'shop-1',
      marketplaceKey: 'default',
      exportName: 'Phone',
      brand: { code: 1, name: 'Generic' },
      category: { code: 2 },
      exportVariations: [{ sellerSku: 'SKU-1', price: 100, currency: 'NGN' }],
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      body: {
        error:
          'Jumia product export was rejected by the marketplace. Review the product details and try again.',
      },
    });
    expect(releaseJumiaExportReservation).toHaveBeenCalled();
    expect(finalizeJumiaExportReservation).not.toHaveBeenCalled();

    const { logger } = await import('@/lib/logger');
    expect(logger.error).toHaveBeenCalledWith({
      message: 'Jumia createProduct feed failed',
      status: 400,
    });
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('private') })
    );
  });

  it('retains the reservation when Jumia may have accepted the create request', async () => {
    const { createProduct } = await import('@/lib/jumia/feeds');
    const { releaseJumiaExportReservation, finalizeJumiaExportReservation } =
      await import('./export-product-reservation');
    const { markAmbiguousJumiaExport } = await import(
      './mark-ambiguous-jumia-export'
    );
    vi.mocked(createProduct).mockRejectedValue(
      new JumiaApiError(502, 'upstream response lost')
    );
    vi.mocked(markAmbiguousJumiaExport).mockResolvedValue(true);

    const result = await submitJumiaExportFeed({
      jumia: {} as never,
      supabase: {} as never,
      merchantId: 'merchant-1',
      productId: 'product-1',
      shopId: 'shop-1',
      marketplaceKey: 'default',
      exportName: 'Phone',
      brand: { code: 1, name: 'Generic' },
      category: { code: 2 },
      exportVariations: [{ sellerSku: 'SKU-1', price: 100, currency: 'NGN' }],
    });

    expect(result).toEqual({
      ok: false,
      status: 502,
      body: {
        error:
          'Jumia product submission outcome is unknown. Retry is blocked while Baci reconciles the reserved SKU to avoid a duplicate listing.',
      },
    });
    expect(releaseJumiaExportReservation).not.toHaveBeenCalled();
    expect(finalizeJumiaExportReservation).not.toHaveBeenCalled();
    expect(markAmbiguousJumiaExport).toHaveBeenCalled();
  });

  it('marks raw transport failures as ambiguous before returning', async () => {
    const { createProduct } = await import('@/lib/jumia/feeds');
    const { releaseJumiaExportReservation, finalizeJumiaExportReservation } =
      await import('./export-product-reservation');
    const { markAmbiguousJumiaExport } = await import(
      './mark-ambiguous-jumia-export'
    );
    vi.mocked(createProduct).mockRejectedValue(
      new TypeError('fetch failed: connection reset')
    );
    vi.mocked(markAmbiguousJumiaExport).mockResolvedValue(true);

    const result = await submitJumiaExportFeed({
      jumia: {} as never,
      supabase: {} as never,
      merchantId: 'merchant-1',
      productId: 'product-1',
      shopId: 'shop-1',
      marketplaceKey: 'default',
      exportName: 'Phone',
      brand: { code: 1, name: 'Generic' },
      category: { code: 2 },
      exportVariations: [{ sellerSku: 'SKU-1', price: 100, currency: 'NGN' }],
    });

    expect(result).toEqual({
      ok: false,
      status: 502,
      body: {
        error:
          'Jumia product submission outcome is unknown. Retry is blocked while Baci reconciles the reserved SKU to avoid a duplicate listing.',
      },
    });
    expect(markAmbiguousJumiaExport).toHaveBeenCalled();
    expect(releaseJumiaExportReservation).not.toHaveBeenCalled();
    expect(finalizeJumiaExportReservation).not.toHaveBeenCalled();
  });

  it('rejects selected marketplace exports when create feeds cannot scope a business client', async () => {
    const { createProduct } = await import('@/lib/jumia/feeds');
    const { releaseJumiaExportReservation } = await import(
      './export-product-reservation'
    );
    vi.mocked(releaseJumiaExportReservation).mockResolvedValue(true);

    const supabase = createScopeSupabase(2);

    const result = await submitJumiaExportFeed({
      jumia: {} as never,
      supabase: supabase as never,
      merchantId: 'merchant-1',
      productId: 'product-1',
      shopId: 'shop-1',
      marketplaceKey: 'jumia-ng',
      exportName: 'Phone',
      brand: { code: 1, name: 'Generic' },
      category: { code: 2 },
      exportVariations: [{ sellerSku: 'SKU-1', price: 100, currency: 'NGN' }],
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      body: {
        error:
          'Jumia product creation cannot target a selected marketplace because the provider create-feed contract has no business-client selector. Use a single-marketplace integration or wait for provider support.',
      },
    });
    expect(createProduct).not.toHaveBeenCalled();
    expect(releaseJumiaExportReservation).toHaveBeenCalled();
  });

  it('allows a self-authorized export when the shop has one active marketplace', async () => {
    const { createProduct } = await import('@/lib/jumia/feeds');
    vi.mocked(createProduct).mockResolvedValue('feed-single');
    const { finalizeJumiaExportReservation } = await import(
      './export-product-reservation'
    );
    vi.mocked(finalizeJumiaExportReservation).mockResolvedValue(true);
    const supabase = createScopeSupabase(1);

    const result = await submitJumiaExportFeed({
      jumia: {} as never,
      supabase: supabase as never,
      merchantId: 'merchant-1',
      productId: 'product-1',
      shopId: 'shop-1',
      marketplaceKey: 'NG-RETAIL',
      exportName: 'Phone',
      brand: { code: 1, name: 'Generic' },
      category: { code: 2 },
      exportVariations: [{ sellerSku: 'SKU-1', price: 100, currency: 'NGN' }],
    });

    expect(result).toEqual({ ok: true, feedId: 'feed-single' });
    expect(createProduct).toHaveBeenCalled();
  });

  it('rejects a single local integration when the provider marketplace does not match', async () => {
    const { createProduct } = await import('@/lib/jumia/feeds');
    const { releaseJumiaExportReservation } = await import(
      './export-product-reservation'
    );
    vi.mocked(verifyJumiaSingleMarketplaceScope).mockResolvedValue({
      ok: false,
      reason: 'marketplace_mismatch',
    });
    vi.mocked(releaseJumiaExportReservation).mockResolvedValue(true);

    const result = await submitJumiaExportFeed({
      jumia: {} as never,
      supabase: createScopeSupabase(1) as never,
      merchantId: 'merchant-1',
      productId: 'product-1',
      shopId: 'shop-1',
      marketplaceKey: 'NG-RETAIL',
      exportName: 'Phone',
      brand: { code: 1, name: 'Generic' },
      category: { code: 2 },
      exportVariations: [{ sellerSku: 'SKU-1', price: 100, currency: 'NGN' }],
    });

    expect(result.ok).toBe(false);
    expect(createProduct).not.toHaveBeenCalled();
    expect(releaseJumiaExportReservation).toHaveBeenCalled();
  });

  it('rejects an OAuth export when the shop exposes multiple marketplaces', async () => {
    const { createProduct } = await import('@/lib/jumia/feeds');
    const { releaseJumiaExportReservation } = await import(
      './export-product-reservation'
    );
    vi.mocked(verifyJumiaSingleMarketplaceScope).mockResolvedValue({
      ok: false,
      reason: 'multiple_active_marketplaces',
    });
    vi.mocked(releaseJumiaExportReservation).mockResolvedValue(true);
    const supabase = createScopeSupabase(1);

    const result = await submitJumiaExportFeed({
      jumia: { shopId: 'shop-1' } as never,
      supabase: supabase as never,
      merchantId: 'merchant-1',
      productId: 'product-1',
      shopId: 'shop-1',
      marketplaceKey: 'oauth',
      exportName: 'Phone',
      brand: { code: 1, name: 'Generic' },
      category: { code: 2 },
      exportVariations: [{ sellerSku: 'SKU-1', price: 100, currency: 'NGN' }],
    });

    expect(result.ok).toBe(false);
    expect(verifyJumiaSingleMarketplaceScope).toHaveBeenCalledWith(
      { shopId: 'shop-1' },
      { strictOAuth: true }
    );
    expect(createProduct).not.toHaveBeenCalled();
    expect(releaseJumiaExportReservation).toHaveBeenCalled();
  });

  it('allows an OAuth export when the shop has a single active marketplace', async () => {
    const { createProduct } = await import('@/lib/jumia/feeds');
    vi.mocked(createProduct).mockResolvedValue('feed-oauth');
    const { finalizeJumiaExportReservation } = await import(
      './export-product-reservation'
    );
    vi.mocked(finalizeJumiaExportReservation).mockResolvedValue(true);
    const supabase = createScopeSupabase(1);

    const result = await submitJumiaExportFeed({
      jumia: { shopId: 'shop-1' } as never,
      supabase: supabase as never,
      merchantId: 'merchant-1',
      productId: 'product-1',
      shopId: 'shop-1',
      marketplaceKey: 'oauth',
      exportName: 'Phone',
      brand: { code: 1, name: 'Generic' },
      category: { code: 2 },
      exportVariations: [{ sellerSku: 'SKU-1', price: 100, currency: 'NGN' }],
    });

    expect(result).toEqual({ ok: true, feedId: 'feed-oauth' });
    expect(verifyJumiaSingleMarketplaceScope).toHaveBeenCalledWith(
      { shopId: 'shop-1' },
      { strictOAuth: true }
    );
    expect(createProduct).toHaveBeenCalled();
  });

  it('releases the reservation when marketplace scope cannot be verified', async () => {
    const { releaseJumiaExportReservation } = await import(
      './export-product-reservation'
    );
    vi.mocked(releaseJumiaExportReservation).mockResolvedValue(true);

    const result = await submitJumiaExportFeed({
      jumia: {} as never,
      supabase: createScopeSupabase(0, { message: 'DB down' }) as never,
      merchantId: 'merchant-1',
      productId: 'product-1',
      shopId: 'shop-1',
      marketplaceKey: 'NG-RETAIL',
      exportName: 'Phone',
      brand: { code: 1, name: 'Generic' },
      category: { code: 2 },
      exportVariations: [{ sellerSku: 'SKU-1', price: 100, currency: 'NGN' }],
    });

    expect(result).toEqual({
      ok: false,
      status: 500,
      body: {
        error: 'Unable to verify the selected Jumia marketplace. Try again.',
      },
    });
    expect(releaseJumiaExportReservation).toHaveBeenCalled();
  });
});
