import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  applyJumiaVariantPriceUpdates,
  type JumiaVariantPriceMapping,
} from './apply-jumia-variant-price-updates';

export interface JumiaSubmittedPriceOverrides {
  jumia_price?: number;
  jumia_sale_price?: number | null;
  jumia_sale_start?: string | null;
  jumia_sale_end?: string | null;
  jumia_prices?: Record<string, number>;
}

const ACCEPTED_FEED_RETRY_GUIDANCE =
  'Refresh before retrying to avoid a duplicate submission.';

/**
 * Persists price/sale overrides only for SKUs the Jumia feed accepted. A
 * per-SKU `jumia_prices` subset must not stamp sale metadata on omitted
 * variants, and a failed feed must persist nothing.
 */
export async function persistSubmittedJumiaPriceUpdate(args: {
  supabase: SupabaseClient;
  merchantId: string;
  mappings: readonly JumiaVariantPriceMapping[];
  overrides: JumiaSubmittedPriceOverrides;
  submittedSkus: readonly string[];
  updatedAt: string;
  updateToken: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    supabase,
    merchantId,
    mappings,
    overrides,
    submittedSkus,
    updatedAt,
    updateToken,
  } = args;
  const submittedPriceUpdate: Record<string, unknown> = {
    updated_at: updatedAt,
  };
  if (Object.hasOwn(overrides, 'jumia_price')) {
    submittedPriceUpdate.jumia_price = overrides.jumia_price;
  }
  if (Object.hasOwn(overrides, 'jumia_sale_price')) {
    submittedPriceUpdate.jumia_sale_price = overrides.jumia_sale_price;
  }
  if (Object.hasOwn(overrides, 'jumia_sale_start')) {
    submittedPriceUpdate.jumia_sale_start = overrides.jumia_sale_start;
  }
  if (Object.hasOwn(overrides, 'jumia_sale_end')) {
    submittedPriceUpdate.jumia_sale_end = overrides.jumia_sale_end;
  }
  const submittedMappings = mappings.filter((mapping) =>
    submittedSkus.includes(mapping.jumia_sku)
  );
  const claimedIds = new Set<string>();
  if (
    Object.keys(submittedPriceUpdate).length > 1 &&
    submittedMappings.length > 0
  ) {
    // Write-time claim: only rows still carrying a load-time baseline
    // token may be overwritten, and the write restamps them with this
    // request's token. Failed saves never stamp, so only an accepted save
    // can supersede another save. Every baseline rides one statement so a
    // split-baseline product cannot be left half-claimed by an
    // interleaving save between grouped writes. Tokens are UUIDs, so they
    // need no escaping inside the OR filter.
    const baselines = new Set(
      submittedMappings.map((mapping) => mapping.update_token ?? null)
    );
    const baselineFilter = [...baselines]
      .map((baseline) =>
        baseline === null
          ? 'update_token.is.null'
          : `update_token.eq.${baseline}`
      )
      .join(',');
    const { data: updatedRows, error: submittedPriceError } = await supabase
      .from('jumia_product_mappings')
      .update({ ...submittedPriceUpdate, update_token: updateToken })
      .in(
        'id',
        submittedMappings.map((mapping) => mapping.id)
      )
      .eq('merchant_id', merchantId)
      .or(baselineFilter)
      .select('id');
    if (submittedPriceError) {
      logger.error({
        message: 'Local submitted-price update failed',
        error: submittedPriceError,
      });
      return {
        ok: false,
        error: `Jumia accepted the price feed but the local sale details could not be saved. ${ACCEPTED_FEED_RETRY_GUIDANCE}`,
      };
    }
    if ((updatedRows?.length ?? 0) < submittedMappings.length) {
      return {
        ok: false,
        error: `Another save updated this product while the Jumia feed was submitting. ${ACCEPTED_FEED_RETRY_GUIDANCE}`,
      };
    }
    for (const mapping of submittedMappings) claimedIds.add(mapping.id);
  }

  if (overrides.jumia_prices) {
    const submittedPrices = Object.fromEntries(
      Object.entries(overrides.jumia_prices).filter(([sku]) =>
        submittedSkus.includes(sku)
      )
    );
    // Rows claimed above now carry this request's token; rebase their
    // baselines so the RPC guard sees the post-claim state instead of the
    // stale load-time token.
    const priceResult = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId,
      mappings: mappings.map((mapping) =>
        claimedIds.has(mapping.id)
          ? { ...mapping, update_token: updateToken }
          : mapping
      ),
      prices: submittedPrices,
      updateToken,
    });
    if (!priceResult.ok) {
      if (priceResult.code === '40001') {
        return {
          ok: false,
          error: `Another save updated this product while the Jumia feed was submitting. ${ACCEPTED_FEED_RETRY_GUIDANCE}`,
        };
      }
      return {
        ok: false,
        error: `Jumia accepted the price feed but the local variant prices could not be saved. ${ACCEPTED_FEED_RETRY_GUIDANCE}`,
      };
    }
  }

  return { ok: true };
}
