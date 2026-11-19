import { collectGoogleMerchantListings } from '@/app/api/feed/google-merchant/collect-google-merchant-listings';
import { getGoogleMerchantFeedData } from '@/app/api/feed/google-merchant/feed-data';
import { buildMerchantBaseUrl } from '@/app/api/feed/google-merchant/route-utils';
import { seedBindingCandidates } from '@/app/api/partners/v1/catalog/seed-bindings';
import { isUuid, resolveFeedMerchant } from '@/lib/feed-identifier';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';

class CatalogExportError extends Error {}

let exportStep = 'validate the merchant UUID';

async function main() {
  const merchantId = process.argv[2];
  if (!merchantId || !isUuid(merchantId)) {
    console.error('Pass the approved merchant UUID.');
    process.exitCode = 1;
    return;
  }

  exportStep = 'resolve the merchant or verify NGN currency';
  const merchant = await resolveFeedMerchant(merchantId, false);
  if (merchant.id !== merchantId) {
    throw new CatalogExportError('Resolved merchant does not match the requested UUID.');
  }
  if (resolveMerchantCurrencyConfig(merchant).code !== 'NGN') {
    throw new CatalogExportError('CrossRem catalog pricing requires NGN.');
  }

  exportStep = 'read the public merchant catalog';
  const data = await getGoogleMerchantFeedData(merchant.id, merchant.slug);
  exportStep = 'render Google listing candidates from a nonempty catalog';
  const rows = collectGoogleMerchantListings(
    data.products,
    merchant,
    buildMerchantBaseUrl({ slug: data.slug, custom_domain: data.custom_domain }),
    data.imageManifest
  );
  if (!rows.length) throw new CatalogExportError('The merchant catalog has no eligible Google listings.');

  exportStep = 'export binding candidates';
  const candidates = seedBindingCandidates(rows);
  process.stdout.write(
    `${JSON.stringify({ merchant_id: merchant.id, ...candidates }, null, 2)}\n`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof CatalogExportError ? error.message : `Unable to ${exportStep}.`);
  process.exitCode = 1;
});
