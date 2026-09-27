import type { SupabaseClient } from '@supabase/supabase-js';
import type { JumiaClient } from '@/lib/jumia/client';
import { verifyJumiaSingleMarketplaceScope } from '@/lib/jumia/verify-jumia-single-marketplace-scope';
import { logger } from '@/lib/logger';
import { releaseJumiaExportReservation } from './export-product-reservation';
import type { ExportVariation } from './export-product-source';

const UNSCOPED_MARKETPLACE_ERROR =
  'Jumia product creation cannot target a selected marketplace because the provider create-feed contract has no business-client selector. Use a single-marketplace integration or wait for provider support.';
const UNVERIFIABLE_MARKETPLACE_ERROR =
  'Unable to verify the selected Jumia marketplace. Try again.';

async function releaseUnscopedReservation(args: {
  supabase: SupabaseClient;
  merchantId: string;
  productId: string;
  shopId: string;
  marketplaceKey: string;
  exportVariations: ExportVariation[];
}) {
  const released = await releaseJumiaExportReservation(args.supabase, args);
  if (!released) {
    logger.error({
      message:
        'Failed to release Jumia export reservation for an unscoped marketplace',
      merchant_id: args.merchantId,
      product_id: args.productId,
    });
  }
}

/**
 * Gates product creation on single-marketplace proof. The create feed
 * accepts a shopId but exposes no business-client selector, so a shared
 * shop must fail closed rather than creating a listing in the wrong
 * marketplace. Failures release the pending reservation.
 */
export async function verifyJumiaExportMarketplaceScope(args: {
  jumia: JumiaClient;
  supabase: SupabaseClient;
  merchantId: string;
  productId: string;
  shopId: string;
  marketplaceKey: string;
  exportVariations: ExportVariation[];
}): Promise<
  { ok: true } | { ok: false; status: number; body: Record<string, unknown> }
> {
  const {
    jumia,
    supabase,
    merchantId,
    productId,
    shopId,
    marketplaceKey,
    exportVariations,
  } = args;

  const normalizedMarketplaceKey =
    typeof marketplaceKey === 'string' ? marketplaceKey.trim() : '';
  const isOAuthMarketplace = normalizedMarketplaceKey === 'oauth';
  const hasUnrepresentableMarketplaceScope =
    normalizedMarketplaceKey !== '' && normalizedMarketplaceKey !== 'default';
  if (!hasUnrepresentableMarketplaceScope) {
    return { ok: true };
  }

  // OAuth persistence collapses every business client of a shop into one
  // integration row, so the row count cannot prove the shop is
  // single-marketplace; provider metadata is the source of truth there.
  if (!isOAuthMarketplace) {
    const { data: activeIntegrations, error: scopeError } = await supabase
      .from('marketplace_integrations')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('platform', 'jumia')
      .eq('shop_id', shopId)
      .eq('is_active', true);
    if (scopeError) {
      logger.error({
        message: 'Failed to verify Jumia product-feed marketplace scope',
        error: scopeError,
      });
      await releaseUnscopedReservation({
        supabase,
        merchantId,
        productId,
        shopId,
        marketplaceKey,
        exportVariations,
      });
      return {
        ok: false,
        status: 500,
        body: { error: UNVERIFIABLE_MARKETPLACE_ERROR },
      };
    }
    if ((activeIntegrations ?? []).length !== 1) {
      await releaseUnscopedReservation({
        supabase,
        merchantId,
        productId,
        shopId,
        marketplaceKey,
        exportVariations,
      });
      return {
        ok: false,
        status: 400,
        body: { error: UNSCOPED_MARKETPLACE_ERROR },
      };
    }
  }

  // This shop has one active destination, so shopId identifies it
  // unambiguously despite the create-feed API lacking a selector.
  const providerScope = await verifyJumiaSingleMarketplaceScope(
    jumia,
    isOAuthMarketplace ? { strictOAuth: true } : undefined
  );
  if (!providerScope.ok) {
    await releaseUnscopedReservation({
      supabase,
      merchantId,
      productId,
      shopId,
      marketplaceKey,
      exportVariations,
    });
    if (providerScope.reason === 'provider_unavailable') {
      return {
        ok: false,
        status: 502,
        body: { error: UNVERIFIABLE_MARKETPLACE_ERROR },
      };
    }
    return {
      ok: false,
      status: 400,
      body: { error: UNSCOPED_MARKETPLACE_ERROR },
    };
  }

  return { ok: true };
}
