import type { SupabaseClient } from '@supabase/supabase-js';
import type { JumiaClient } from '@/lib/jumia/client';
import { createProduct } from '@/lib/jumia/feeds';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { logger } from '@/lib/logger';
import {
  finalizeJumiaExportReservation,
  markJumiaExportReservationForReconciliation,
  releaseJumiaExportReservation,
} from './export-product-reservation';
import type { ExportVariation } from './export-product-source';
import { markAmbiguousJumiaExport } from './mark-ambiguous-jumia-export';
import { verifyJumiaExportMarketplaceScope } from './verify-jumia-export-marketplace-scope';

const JUMIA_EXPORT_REJECTION_MESSAGE =
  'Jumia product export was rejected by the marketplace. Review the product details and try again.';

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

  const marketplaceScope = await verifyJumiaExportMarketplaceScope({
    jumia,
    supabase,
    merchantId,
    productId,
    shopId,
    marketplaceKey,
    exportVariations,
  });
  if (!marketplaceScope.ok) {
    return marketplaceScope;
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
