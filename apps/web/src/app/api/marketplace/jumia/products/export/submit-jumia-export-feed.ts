import type { SupabaseClient } from '@supabase/supabase-js';
import type { JumiaClient } from '@/lib/jumia/client';
import { createProduct } from '@/lib/jumia/feeds';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { verifyJumiaSingleMarketplaceScope } from '@/lib/jumia/verify-jumia-single-marketplace-scope';
import { logger } from '@/lib/logger';
import {
  finalizeJumiaExportReservation,
  markJumiaExportReservationForReconciliation,
  releaseJumiaExportReservation,
} from './export-product-reservation';
import type { ExportVariation } from './export-product-source';
import { markAmbiguousJumiaExport } from './mark-ambiguous-jumia-export';

const JUMIA_EXPORT_REJECTION_MESSAGE =
  'Jumia product export was rejected by the marketplace. Review the product details and try again.';

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

export async function submitJumiaExportFeed(args: {
  jumia: JumiaClient;
  supabase: SupabaseClient;
  merchantId: string;
  productId: string;
  shopId: string;
  marketplaceKey: string;
  exportName: string;
  exportDescription?: string;
  exportImages?: Array<{ url: string; primary?: boolean }>;
  brand: { code: number; name: string };
  category: { code: number };
  exportVariations: ExportVariation[];
}): Promise<
  | { ok: true; feedId: string }
  | { ok: false; status: number; body: Record<string, unknown> }
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

  // The product-creation feed accepts a shopId but does not expose the
  // businessClients selector supported by price/status feeds. A single active
  // marketplace is therefore safe (the shop has no other destination), while
  // a shared shop must fail closed rather than creating a listing elsewhere.
  const normalizedMarketplaceKey =
    typeof marketplaceKey === 'string' ? marketplaceKey.trim() : '';
  const isOAuthMarketplace = normalizedMarketplaceKey === 'oauth';
  const hasUnrepresentableMarketplaceScope =
    normalizedMarketplaceKey !== '' && normalizedMarketplaceKey !== 'default';
  if (hasUnrepresentableMarketplaceScope) {
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
          body: {
            error:
              'Unable to verify the selected Jumia marketplace. Try again.',
          },
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
          body: {
            error:
              'Jumia product creation cannot target a selected marketplace because the provider create-feed contract has no business-client selector. Use a single-marketplace integration or wait for provider support.',
          },
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
          body: {
            error:
              'Unable to verify the selected Jumia marketplace. Try again.',
          },
        };
      }
      return {
        ok: false,
        status: 400,
        body: {
          error:
            'Jumia product creation cannot target a selected marketplace because the provider create-feed contract has no business-client selector. Use a single-marketplace integration or wait for provider support.',
        },
      };
    }
  }

  let feedId: string;
  try {
    feedId = await createProduct(jumia, shopId, [
      {
        name: { value: args.exportName },
        brand: args.brand,
        category: args.category,
        description: args.exportDescription
          ? { value: args.exportDescription }
          : undefined,
        images: args.exportImages,
        variations: exportVariations.map((variation) => ({
          sellerSku: variation.sellerSku,
          globalPrice: {
            value: variation.price,
            currency: variation.currency,
          },
          stock: variation.stock,
          attributes: variation.attributes,
        })),
      },
    ]);
  } catch (feedError) {
    if (feedError instanceof JumiaApiError) {
      const definitiveRejection =
        feedError.status >= 400 &&
        feedError.status < 500 &&
        feedError.status !== 408;
      if (definitiveRejection) {
        const released = await releaseJumiaExportReservation(supabase, {
          merchantId,
          productId,
          shopId,
          marketplaceKey,
          exportVariations,
        });
        if (!released) {
          logger.error({
            message:
              'Failed to release Jumia export reservation after definitive rejection',
            merchant_id: merchantId,
            product_id: productId,
          });
        }
      } else {
        const marked = await markAmbiguousJumiaExport(supabase, {
          merchantId,
          productId,
          shopId,
          marketplaceKey,
          exportVariations,
        });
        if (!marked) {
          logger.error({
            message: 'Failed to record ambiguous Jumia export for recovery',
            merchant_id: merchantId,
            product_id: productId,
          });
        }
      }
      logger.error({
        message: 'Jumia createProduct feed failed',
        status: feedError.status,
      });
      return {
        ok: false,
        status: feedError.status,
        body: {
          error: definitiveRejection
            ? JUMIA_EXPORT_REJECTION_MESSAGE
            : 'Jumia product submission outcome is unknown. Retry is blocked while Baci reconciles the reserved SKU to avoid a duplicate listing.',
        },
      };
    }
    const marked = await markAmbiguousJumiaExport(supabase, {
      merchantId,
      productId,
      shopId,
      marketplaceKey,
      exportVariations,
    });
    if (!marked) {
      logger.error({
        message: 'Failed to record ambiguous Jumia transport failure',
        merchant_id: merchantId,
        product_id: productId,
      });
    }
    logger.error({
      message: 'Jumia createProduct transport failed',
      error: feedError,
    });
    return {
      ok: false,
      status: 502,
      body: {
        error:
          'Jumia product submission outcome is unknown. Retry is blocked while Baci reconciles the reserved SKU to avoid a duplicate listing.',
      },
    };
  }

  const finalized = await finalizeJumiaExportReservation(supabase, {
    merchantId,
    productId,
    shopId,
    marketplaceKey,
    feedId,
    exportVariations,
  });

  if (!finalized) {
    logger.error({
      message: 'Jumia export mapping finalize failed',
      feed_id: feedId,
    });
    const reconciliationRecorded =
      await markJumiaExportReservationForReconciliation(supabase, {
        merchantId,
        productId,
        shopId,
        marketplaceKey,
        feedId,
        exportVariations,
      });
    return {
      ok: false,
      status: 207,
      body: {
        success: false,
        partial: true,
        feedId,
        error: reconciliationRecorded
          ? 'Product export initiated but local mapping failed to save feed ID. Feed-status reconciliation will recover the accepted feed.'
          : 'Product export initiated, but automatic reconciliation could not be recorded. Contact support and provide the feed ID.',
      },
    };
  }

  return { ok: true, feedId };
}
