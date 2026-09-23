import type { SupabaseClient } from '@supabase/supabase-js';
import { getAllProducts } from '@/lib/jumia/catalog';
import type { JumiaClient } from '@/lib/jumia/client';
import {
  loadJumiaMarketplaceCurrency,
  validateJumiaMarketplaceCurrencyForMerchant,
} from '@/lib/jumia/jumia-marketplace-currency';
import { verifyJumiaSingleMarketplaceScope } from '@/lib/jumia/verify-jumia-single-marketplace-scope';
import { logger } from '@/lib/logger';

type LoadJumiaImportContextArgs = {
  createJumiaClient: () => Promise<JumiaClient>;
};

type LoadJumiaImportContextResult =
  | {
      ok: true;
      jumia: Awaited<ReturnType<typeof JumiaClient.forIntegration>>;
      jumiaProducts: Awaited<ReturnType<typeof getAllProducts>>;
    }
  | {
      ok: false;
      error: string;
      status: 403 | 404 | 409 | 500 | 502;
    };

export async function loadJumiaImportContext({
  createJumiaClient,
}: LoadJumiaImportContextArgs): Promise<LoadJumiaImportContextResult> {
  let jumia: Awaited<ReturnType<typeof JumiaClient.forIntegration>>;
  try {
    jumia = await createJumiaClient();
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      typeof err.status === 'number'
    ) {
      if (err.status === 404) {
        return { ok: false, error: 'Integration not found', status: 404 };
      }
      if (err.status === 403 || err.status === 401) {
        return { ok: false, error: 'Forbidden', status: 403 };
      }
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({
      message: 'Failed to initialize Jumia client',
      error: message,
    });
    return {
      ok: false,
      error: 'Failed to initialize Jumia client',
      status: 500,
    };
  }

  try {
    const marketplaceKey = jumia.marketplaceKey?.trim();
    const isMarketplaceScoped =
      marketplaceKey &&
      marketplaceKey !== 'oauth' &&
      marketplaceKey !== 'default';
    if (isMarketplaceScoped) {
      const scope = await verifyJumiaSingleMarketplaceScope(jumia);
      if (!scope.ok) {
        if (scope.reason === 'provider_unavailable') {
          return {
            ok: false,
            error: 'Unable to verify the Jumia marketplace scope',
            status: 502,
          };
        }
        if (scope.reason === 'multiple_active_marketplaces') {
          return {
            ok: false,
            error:
              'Jumia catalog import is unavailable when a shop has multiple active marketplaces',
            status: 409,
          };
        }
        return {
          ok: false,
          error:
            'Jumia catalog import is unavailable because the selected marketplace is not active for this shop',
          status: 409,
        };
      }
    }
    const productQuery = {
      status: 'active' as const,
      ...(jumia.shopId === 'oauth' ? {} : { shopId: jumia.shopId }),
    };
    const jumiaProducts = await getAllProducts(jumia, productQuery);
    return { ok: true, jumia, jumiaProducts };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({
      message: 'Failed to fetch products from Jumia',
      error: message,
    });
    return {
      ok: false,
      error: 'Failed to fetch products from Jumia',
      status: 502,
    };
  }
}

type ValidateJumiaImportCurrencyArgs = {
  supabase: SupabaseClient;
  merchantId: string;
  integrationId: string;
};

type ValidateJumiaImportCurrencyResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Provider prices carry no currency; a marketplace/merchant mismatch would
 * store foreign-denominated amounts as local prices.
 */
export async function validateJumiaImportCurrency({
  supabase,
  merchantId,
  integrationId,
}: ValidateJumiaImportCurrencyArgs): Promise<ValidateJumiaImportCurrencyResult> {
  const currencyResult = await loadJumiaMarketplaceCurrency(
    supabase,
    merchantId,
    integrationId
  );
  if (!currencyResult.ok) {
    return {
      ok: false,
      error: currencyResult.error,
      status: currencyResult.status,
    };
  }

  const merchantCurrencyResult =
    await validateJumiaMarketplaceCurrencyForMerchant(
      supabase,
      merchantId,
      currencyResult.currency
    );
  if (!merchantCurrencyResult.ok) {
    return {
      ok: false,
      error: merchantCurrencyResult.error,
      status: merchantCurrencyResult.status,
    };
  }

  return { ok: true };
}
