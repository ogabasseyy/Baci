import { fileURLToPath } from 'node:url';
import { collectGoogleMerchantListings } from '@/app/api/feed/google-merchant/collect-google-merchant-listings';
import { getGoogleMerchantFeedData } from '@/app/api/feed/google-merchant/feed-data';
import { buildMerchantBaseUrl } from '@/app/api/feed/google-merchant/route-utils';
import { seedBindingCandidates } from '@/app/api/partners/v1/catalog/seed-bindings';
import { isUuid, resolveFeedMerchant } from '@/lib/feed-identifier';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';

class CatalogExportError extends Error {}

export async function exportCrossRemCatalogBindings(merchantId: string) {
  let exportStep = 'validate the merchant UUID';
  if (!merchantId || !isUuid(merchantId)) {
    throw new CatalogExportError('Pass the approved merchant UUID.');
  }

  try {
    exportStep = 'resolve the merchant or verify NGN currency';
    const merchant = await resolveFeedMerchant(merchantId, false);
    if (merchant.id !== merchantId) {
      throw new CatalogExportError(
        'Resolved merchant does not match the requested UUID.'
      );
    }
    if (resolveMerchantCurrencyConfig(merchant).code !== 'NGN') {
      throw new CatalogExportError('CrossRem catalog pricing requires NGN.');
    }
    if (merchant.gmc_variants_enabled === false) {
      throw new CatalogExportError(
        'CrossRem binding exports require a SKU-expanded Google Merchant feed.'
      );
    }

    exportStep = 'read the public merchant catalog';
    const data = await getGoogleMerchantFeedData(merchant.id, merchant.slug);
    exportStep = 'render Google listing candidates from a nonempty catalog';
    const rows = collectGoogleMerchantListings(
      data.products,
      merchant,
      buildMerchantBaseUrl({
        slug: data.slug,
        custom_domain: data.custom_domain,
      }),
      data.imageManifest
    );
    if (!rows.length) {
      throw new CatalogExportError(
        'The merchant catalog has no eligible Google listings.'
      );
    }

    exportStep = 'export binding candidates';
    const candidates = seedBindingCandidates(rows);
    return { merchant_id: merchant.id, ...candidates };
  } catch (error) {
    if (error instanceof CatalogExportError) throw error;
    throw new Error(`Unable to ${exportStep}.`, { cause: error });
  }
}

async function main() {
  const merchantId = process.argv[2];
  if (!merchantId || !isUuid(merchantId)) {
    console.error('Pass the approved merchant UUID.');
    process.exitCode = 1;
    return;
  }

  const output = await exportCrossRemCatalogBindings(merchantId);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Catalog export failed.');
    process.exitCode = 1;
  });
}
